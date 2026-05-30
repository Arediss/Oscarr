import { prisma } from '../utils/prisma.js';
import { getArrClient, getServiceTypeForMedia } from '../providers/index.js';
import { normalizeLanguages } from '../utils/languages.js';
import { logEvent } from '../utils/logEvent.js';
import { COMPLETABLE_REQUEST_STATUSES } from '@oscarr/shared';
import type { MediaStateCategory } from '@oscarr/shared';
import { getTvDetails } from './tmdb.js';
import { transitionRequestStatus } from './requestStatusTransition.js';
import type { Media } from '@prisma/client';

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

/** Cascades a media's category onto its linked requests (guarded transition).
 *  AVAILABLE completes in-flight requests; PROCESSING marks approved/failed as downloading. */
async function cascadeRequestsForCategory(mediaId: number, category: MediaStateCategory): Promise<void> {
  if (category === 'AVAILABLE') {
    await transitionRequestStatus(
      { requestId: undefined, from: undefined, to: 'available', why: 'cascade-media-available' },
      () => prisma.mediaRequest.updateMany({
        where: { mediaId, status: { in: [...COMPLETABLE_REQUEST_STATUSES] } },
        data: { status: 'available' },
      }),
    );
  } else if (category === 'PROCESSING') {
    await transitionRequestStatus(
      { requestId: undefined, from: undefined, to: 'processing', why: 'cascade-media-processing' },
      () => prisma.mediaRequest.updateMany({
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
    const currentArrId = media.mediaType === 'movie' ? media.radarrId : media.sonarrId;
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
