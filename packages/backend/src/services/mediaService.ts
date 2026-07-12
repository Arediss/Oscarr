import { prisma } from '../utils/prisma.js';
import { getArrClient, getServiceTypeForMedia, arrIdForMedia } from '../providers/index.js';
import { normalizeLanguages } from '../utils/languages.js';
import { logEvent } from '../utils/logEvent.js';
import { COMPLETABLE_REQUEST_STATUSES } from '@oscarr/shared';
import type { MediaStateCategory } from '@oscarr/shared';
import { getTvDetails } from './tmdb.js';
import { transitionRequestStatus } from './requestStatusTransition.js';
import { Prisma, type Media } from '@prisma/client';

// ---------------------------------------------------------------------------
// Shared media lookup helpers — used by sync, webhooks, request flow.
// ---------------------------------------------------------------------------

/** Resolve an *arr external id (tmdbId for movies, tvdbId for TV) to the local Media row.
 *  TV tolerates legacy `-tvdbId` placeholder rows so webhook + sync paths share the same
 *  lookup semantics. Returns null when nothing matches. */
export function findMediaByExternalId(
  mediaType: 'movie' | 'tv',
  externalId: number,
): Promise<Media | null> {
  if (mediaType === 'movie') {
    return prisma.media.findUnique({
      where: { tmdbId_mediaType: { tmdbId: externalId, mediaType: 'movie' } },
    });
  }
  return prisma.media.findFirst({
    where: { mediaType: 'tv', OR: [{ tvdbId: externalId }, { tmdbId: -externalId }] },
  });
}

/** Resolve a tmdbId to its tvdbId via TMDB external_ids. Cached implicitly by the TMDB
 *  cache layer; returns null when TMDB has no tvdb mapping. */
export async function resolveTvdbId(tmdbId: number): Promise<number | null> {
  try {
    const data = await getTvDetails(tmdbId);
    return data.external_ids?.tvdb_id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TV placeholder (-tvdbId) upgrade/merge — single owner for the sync, request and keyword paths.
// A TV row known only by its tvdb id is stored as tmdbId = -tvdbId until its real tmdbId resolves.
// ---------------------------------------------------------------------------

/** Find the legacy -tvdbId placeholder row for a TV show, if any. */
export function findTvPlaceholder(tvdbId: number): Promise<Media | null> {
  return prisma.media.findFirst({ where: { mediaType: 'tv', tvdbId, tmdbId: { lt: 0 } } });
}

/** True iff the error is a P2002 unique-constraint violation on (tmdbId, mediaType). */
export function isTmdbMediaTypeConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('tmdbId') && target.includes('mediaType');
  return typeof target === 'string' && target.includes('tmdbId');
}

export interface PlaceholderMergeOpts {
  /** Canonical seasons to (re)create on merge — used by the sync path which has Sonarr season data. */
  seasons?: { seasonNumber: number; episodeCount: number; statusCategory?: string }[];
  /** Cascade COMPLETABLE requests to 'available' after the write. */
  becameAvailable?: boolean;
}

/** Request status advancement rank — higher = more progressed (kept on a per-user merge). */
const REQUEST_STATUS_RANK: Record<string, number> = { declined: 0, failed: 1, pending: 2, approved: 3, processing: 4, available: 5 };
const requestRank = (status: string): number => REQUEST_STATUS_RANK[status] ?? -1;

/** *arr-state fields the placeholder tracked that a narrow mergeData must not silently discard. */
const PLACEHOLDER_INHERITED_FIELDS = ['tvdbId', 'sonarrId', 'radarrId', 'qualityProfileId', 'availableAt', 'audioLanguages', 'subtitleLanguages', 'lastEpisodeInfo', 'contentRating', 'keywordIds'] as const;

/** Merge a -tvdbId placeholder into the canonical positive-tmdbId row and delete the placeholder.
 *  Per user, keeps the most-advanced request and drops the other so nobody ends up with two and no
 *  user's better request is lost. Fields the caller doesn't set inherit the placeholder's *arr
 *  state (sonarrId, statusCategory, seasons, …) when the canonical lacks it — the request/keyword
 *  callers pass only metadata and must not lose the Sonarr linkage the sync-owned placeholder
 *  tracked. Returns the surviving (canonical) row. */
export async function mergeTvPlaceholderInto(
  placeholder: Media,
  canonicalId: number,
  mergeData: Record<string, unknown>,
  opts?: PlaceholderMergeOpts,
): Promise<Media> {
  const { tmdbId: _drop, ...data } = mergeData;
  const merged = await prisma.$transaction(async (tx) => {
    const existing = await tx.media.findUniqueOrThrow({ where: { id: canonicalId } });

    // Reconcile per-user duplicate requests (re-parent before deleting the placeholder, whose FK
    // cascades on delete): for a user present on both rows, keep the more-advanced request.
    const [placeholderReqs, canonicalReqs] = await Promise.all([
      tx.mediaRequest.findMany({ where: { mediaId: placeholder.id }, select: { id: true, userId: true, status: true } }),
      tx.mediaRequest.findMany({ where: { mediaId: canonicalId }, select: { id: true, userId: true, status: true } }),
    ]);
    const canonicalByUser = new Map(canonicalReqs.map((r) => [r.userId, r]));
    const toReparent: number[] = [];
    const toDelete: number[] = [];
    for (const p of placeholderReqs) {
      const c = canonicalByUser.get(p.userId);
      if (!c) toReparent.push(p.id);
      else if (requestRank(p.status) > requestRank(c.status)) { toDelete.push(c.id); toReparent.push(p.id); }
      else toDelete.push(p.id);
    }
    if (toDelete.length) await tx.mediaRequest.deleteMany({ where: { id: { in: toDelete } } });
    if (toReparent.length) await tx.mediaRequest.updateMany({ where: { id: { in: toReparent } }, data: { mediaId: canonicalId } });

    // Inherit *arr state the caller didn't set and the canonical lacks. statusCategory only ever
    // advances from the default (never regress a canonical that already knows better).
    const inherited: Record<string, unknown> = {};
    for (const field of PLACEHOLDER_INHERITED_FIELDS) {
      if (!(field in data) && existing[field] == null && placeholder[field] != null) inherited[field] = placeholder[field];
    }
    const adoptedCategory = !('statusCategory' in data) && existing.statusCategory === 'UNAVAILABLE' && placeholder.statusCategory !== 'UNAVAILABLE'
      ? placeholder.statusCategory
      : null;
    if (adoptedCategory) {
      inherited.statusCategory = adoptedCategory;
      if (adoptedCategory === 'AVAILABLE' && !('availableAt' in data) && inherited.availableAt == null && !existing.availableAt) inherited.availableAt = new Date();
    }

    // Seasons: the sync path recreates them from opts; otherwise re-parent the placeholder's rows
    // when the canonical has none — they carry per-season availability the canonical would lose.
    const keepPlaceholderSeasons = !opts?.seasons?.length
      && (await tx.season.count({ where: { mediaId: canonicalId } })) === 0;
    if (keepPlaceholderSeasons) await tx.season.updateMany({ where: { mediaId: placeholder.id }, data: { mediaId: canonicalId } });
    else await tx.season.deleteMany({ where: { mediaId: placeholder.id } });
    await tx.media.delete({ where: { id: placeholder.id } });

    const canonical = await tx.media.update({ where: { id: canonicalId }, data: { ...inherited, ...data } });
    if (opts?.seasons?.length) {
      await tx.season.deleteMany({ where: { mediaId: canonicalId } });
      await tx.season.createMany({
        data: opts.seasons.map((s) => ({ mediaId: canonicalId, seasonNumber: s.seasonNumber, episodeCount: s.episodeCount, ...(s.statusCategory ? { statusCategory: s.statusCategory } : {}) })),
      });
    }
    if (opts?.becameAvailable || adoptedCategory === 'AVAILABLE') await cascadeRequestsForCategory(canonicalId, 'AVAILABLE', tx);
    else if (adoptedCategory === 'PROCESSING') await cascadeRequestsForCategory(canonicalId, 'PROCESSING', tx);
    return canonical;
  });
  logEvent('debug', 'Media', `merged placeholder TV row ${placeholder.id} into canonical ${canonicalId}`);
  return merged;
}

/** Upgrade a placeholder to its real tmdbId, or merge into the existing canonical row on a unique
 *  conflict. Returns the SURVIVING row — its id may differ from the placeholder's, so callers must
 *  use the returned row, not assume an in-place upgrade. `mergeData` must not set tmdbId. */
export async function upgradeOrMergeTvPlaceholder(
  placeholder: Media,
  realTmdbId: number,
  mergeData: Record<string, unknown>,
  opts?: PlaceholderMergeOpts,
): Promise<Media> {
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.media.update({ where: { id: placeholder.id }, data: { tmdbId: realTmdbId, ...mergeData } });
      if (opts?.becameAvailable) await cascadeRequestsForCategory(placeholder.id, 'AVAILABLE', tx);
      return updated;
    });
  } catch (err) {
    if (!isTmdbMediaTypeConflict(err)) throw err;
    const canonical = await prisma.media.findFirst({ where: { tmdbId: realTmdbId, mediaType: 'tv', NOT: { id: placeholder.id } } });
    if (!canonical) throw err;
    return mergeTvPlaceholderInto(placeholder, canonical.id, mergeData, opts);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiveCheckResult {
  liveAvailable: boolean;
  sonarrSeasonStats: { seasonNumber: number; episodeFileCount: number; episodeCount: number; totalEpisodeCount: number }[] | null;
  audioLanguages: string[] | null;
  subtitleLanguages: string[] | null;
  timedOut?: boolean;
}

const LIVE_CHECK_TIMEOUT = 2000;

// Slightly above new_media_sync cron interval — DB is fresh enough to skip the live hit.
const LIVE_CHECK_SKIP_WINDOW_MS = 15 * 60 * 1000;

export function canSkipLiveCheck(mediaStatus: string | null | undefined, availableAt: Date | null | undefined): boolean {
  if (mediaStatus !== 'AVAILABLE' || !availableAt) return false;
  return Date.now() - new Date(availableAt).getTime() < LIVE_CHECK_SKIP_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Live check against Radarr/Sonarr
// ---------------------------------------------------------------------------

export async function performLiveCheck(
  mediaType: string,
  tmdbId: number,
  tvdbId: number | null,
  hasCachedAudio: boolean,
): Promise<LiveCheckResult> {
  const result: LiveCheckResult = { liveAvailable: false, sonarrSeasonStats: null, audioLanguages: null, subtitleLanguages: null };
  try {
    const serviceType = getServiceTypeForMedia(mediaType);
    const client = await getArrClient(serviceType);

    let externalId: number | null = mediaType === 'movie' ? tmdbId : tvdbId;
    if (!externalId && mediaType === 'tv') {
      const { getTvDetails } = await import('./tmdb.js');
      const tmdbData = await getTvDetails(tmdbId);
      externalId = tmdbData.external_ids?.tvdb_id ?? null;
    }
    if (!externalId) return result;

    const availability = await client.checkAvailability(externalId);
    result.liveAvailable = availability.available;
    if (!hasCachedAudio) {
      result.audioLanguages = availability.audioLanguages;
      result.subtitleLanguages = availability.subtitleLanguages;
    }
    if (availability.seasonStats) {
      result.sonarrSeasonStats = availability.seasonStats;
    }
  } catch { /* Service unreachable, use DB state */ }
  return result;
}

/** Run live check with a timeout — returns DB-only result if service is slow */
export async function performLiveCheckWithTimeout(
  mediaType: string,
  tmdbId: number,
  tvdbId: number | null,
  hasCachedAudio: boolean,
): Promise<LiveCheckResult> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timedOutResult: LiveCheckResult = { liveAvailable: false, sonarrSeasonStats: null, audioLanguages: null, subtitleLanguages: null, timedOut: true };
  return Promise.race([
    performLiveCheck(mediaType, tmdbId, tvdbId, hasCachedAudio).finally(() => clearTimeout(timeoutHandle)),
    new Promise<LiveCheckResult>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(timedOutResult), LIVE_CHECK_TIMEOUT);
    }),
  ]);
}

// ---------------------------------------------------------------------------
// DB side-effects after live check
// ---------------------------------------------------------------------------

export async function cacheLanguageData(
  mediaId: number,
  audio: string[] | null,
  subs: string[] | null,
): Promise<void> {
  const normalizedAudio = audio ? normalizeLanguages(audio) : null;
  const normalizedSubs = subs ? normalizeLanguages(subs) : null;
  if (!normalizedAudio && !normalizedSubs) return;

  const langUpdate: Record<string, string> = {};
  if (normalizedAudio) langUpdate.audioLanguages = JSON.stringify(normalizedAudio);
  if (normalizedSubs) langUpdate.subtitleLanguages = JSON.stringify(normalizedSubs);
  await prisma.media.update({ where: { id: mediaId }, data: langUpdate });
}

/** Cascades a media's category onto its linked requests (guarded transition). Pass `tx` to run
 *  inside a transaction. AVAILABLE completes in-flight requests; PROCESSING marks approved/failed
 *  as downloading. Single owner — sync, placeholder merge and the webhook grab all route here. */
export async function cascadeRequestsForCategory(mediaId: number, category: MediaStateCategory, tx: Prisma.TransactionClient = prisma): Promise<void> {
  if (category === 'AVAILABLE') {
    await transitionRequestStatus(
      { requestId: undefined, from: undefined, to: 'available', why: 'cascade-media-available' },
      () => tx.mediaRequest.updateMany({
        where: { mediaId, status: { in: [...COMPLETABLE_REQUEST_STATUSES] } },
        data: { status: 'available' },
      }),
    );
  } else if (category === 'PROCESSING') {
    await transitionRequestStatus(
      { requestId: undefined, from: undefined, to: 'processing', why: 'cascade-media-processing' },
      () => tx.mediaRequest.updateMany({
        where: { mediaId, status: { in: ['approved', 'failed'] } },
        data: { status: 'processing' },
      }),
    );
  }
}

export async function promoteMediaToAvailable(
  mediaId: number,
  hasAvailableAt: boolean,
): Promise<void> {
  await prisma.media.update({
    where: { id: mediaId },
    data: { statusCategory: 'AVAILABLE', ...(!hasAvailableAt ? { availableAt: new Date() } : {}) },
  });
  await cascadeRequestsForCategory(mediaId, 'AVAILABLE');
}

/** Recomputes a media's category via the connector (queue included) and persists it.
 *  Resolves the *arr id by externalId when missing, then cascades linked requests. Best-effort. */
export async function refreshMediaCategory(media: {
  id: number;
  mediaType: string;
  tmdbId: number;
  tvdbId: number | null;
  statusCategory: string;
  radarrId: number | null;
  sonarrId: number | null;
  availableAt: Date | null;
}): Promise<MediaStateCategory | null> {
  try {
    const client = await getArrClient(getServiceTypeForMedia(media.mediaType));
    const currentArrId = arrIdForMedia(media);
    let serviceMediaId = currentArrId;
    if (!serviceMediaId) {
      const externalId = media.mediaType === 'movie' ? media.tmdbId : media.tvdbId;
      if (!externalId) return null;
      const found = await client.findByExternalId(externalId);
      if (!found) return null;
      serviceMediaId = found.id;
    }
    const item = await client.getMediaById(serviceMediaId);
    if (!item) return null;
    const cat = item.statusCategory;
    if (cat === media.statusCategory && serviceMediaId === currentArrId) return cat;

    const becameAvailable = cat === 'AVAILABLE' && media.statusCategory !== 'AVAILABLE';
    await prisma.media.update({
      where: { id: media.id },
      data: {
        statusCategory: cat,
        [client.dbIdField]: serviceMediaId,
        ...(becameAvailable && !media.availableAt ? { availableAt: new Date() } : {}),
      },
    });

    if (becameAvailable) {
      await cascadeRequestsForCategory(media.id, 'AVAILABLE');
    } else if (cat === 'PROCESSING' && media.statusCategory !== 'PROCESSING') {
      await cascadeRequestsForCategory(media.id, 'PROCESSING');
    }
    return cat;
  } catch (err) {
    logEvent('warn', 'Media', `refreshMediaCategory failed for ${media.mediaType}:${media.tmdbId}`, err);
    return null;
  }
}
