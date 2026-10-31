import { prisma } from '../../utils/prisma.js';
import { patchAppSettings } from '../../utils/appSettings.js';
import { getArrClientForService, arrIdFieldForClient } from '../../providers/index.js';
import type { ArrClient, ArrMediaItem } from '../../providers/types.js';
import { getAllServices } from '../../utils/services.js';
import { logEvent } from '../../utils/logEvent.js';
import type { SyncResult } from './helpers.js';
import { sendAvailabilityNotifications } from './helpers.js';
import { isTmdbMediaTypeConflict, mergeTvPlaceholderInto, cascadeRequestsForCategory } from '../mediaService.js';
import type { Media } from '@prisma/client';

/** Every enabled instance, not just the default: requests are dispatched to any of them.
 *  Sequential — SQLite takes a single writer and a full scan is our heaviest job. */
export async function syncArrService(serviceType: string, since?: Date | null): Promise<SyncResult> {
  const start = Date.now();
  const services = await getAllServices(serviceType);
  if (services.length === 0) {
    logEvent('debug', 'Sync', `${serviceType}: no service configured, skipping`);
    return { added: 0, updated: 0, errors: 0, duration: 0 };
  }

  const total: SyncResult = { added: 0, updated: 0, errors: 0, duration: 0 };
  let mediaType: ArrClient['mediaType'] | null = null;
  let allReached = true;

  for (const service of services) {
    const client = getArrClientForService(service.id, serviceType, service.config);
    mediaType = client.mediaType;
    const label = services.length > 1 ? `${serviceType}[${service.name}]` : serviceType;
    const result = await syncOneInstance(client, service.id, label, since);
    total.added += result.added;
    total.updated += result.updated;
    total.errors += result.errors;
    if (!result.reached) allReached = false;
  }

  // One timestamp for the whole type, and only if every instance answered — moving the window
  // past a library we never read would drop whatever it added during the outage.
  if (mediaType && allReached) {
    await patchAppSettings({ [mediaType === 'movie' ? 'lastRadarrSync' : 'lastSonarrSync']: new Date() });
  }

  total.duration = Date.now() - start;
  return total;
}

/** One pass over a single instance. Stamps `serviceId` on every row it touches. */
async function syncOneInstance(
  client: ArrClient,
  serviceId: number,
  serviceType: string,
  since?: Date | null,
): Promise<SyncResult & { reached: boolean }> {
  const start = Date.now();
  let added = 0, updated = 0, errors = 0, reached = true;

  try {
    const allMedia = await client.getAllMedia();

    let filtered = allMedia;
    if (since) {
      const newlyAdded = allMedia.filter(m => m.addedDate && new Date(m.addedDate) > since);
      const nativeByExternalId = new Map(allMedia.map(item => [item.externalId, item]));
      // Always refresh in-progress items (queue / partial) so PROCESSING + the *arr id land within one cycle, even without a webhook.
      const inProgressItems = allMedia.filter(m => m.statusCategory === 'PROCESSING');

      const storedMedia = await prisma.media.findMany({
        where: {
          mediaType: client.mediaType,
          // Rows owned by another instance are its job — pulling them in here caused flapping.
          OR: [{ serviceId }, { serviceId: null }],
        },
        select: { tmdbId: true, tvdbId: true, statusCategory: true, qualityProfileId: true },
      });

      const needsUpdateIds = new Set<number>();
      for (const row of storedMedia) {
        const id = client.mediaType === 'movie' ? row.tmdbId : (row.tvdbId ?? row.tmdbId);
        const native = nativeByExternalId.get(id);
        if (!native) continue;
        const becameAvailable = native.statusCategory === 'AVAILABLE'
          && ['UNAVAILABLE', 'UPCOMING', 'SEARCHING', 'PROCESSING'].includes(row.statusCategory);
        // Editing a profile in the service does not change its added date or availability.
        // Compare the catalog already fetched above so old available titles refresh too.
        const profileChanged = native.qualityProfileId !== null && native.qualityProfileId !== row.qualityProfileId;
        if (becameAvailable || profileChanged) needsUpdateIds.add(id);
      }

      const toUpdate = allMedia.filter(m => needsUpdateIds.has(m.externalId));
      const combined = new Map<number, ArrMediaItem>();
      for (const m of [...newlyAdded, ...toUpdate, ...inProgressItems]) combined.set(m.externalId, m);
      filtered = [...combined.values()];

      if (needsUpdateIds.size > 0) {
        logEvent('debug', 'Sync', `${serviceType} incremental: ${newlyAdded.length} newly added, ${toUpdate.length} need status or profile update`);
      }
    }

    logEvent('debug', 'Sync', `${serviceType}: ${filtered.length} items to process (${since ? 'incremental' : 'full scan'})`);

    // Bulk-fetch existing media for every externalId in one query — the previous per-item
    // findUnique/findFirst was the dominant N+1 cost (10k items → 10k round-trips). Build a
    // Map keyed by the external ID the service speaks (tmdbId for movies, tvdbId for TV with
    // legacy -(tmdbId) placeholders as a fallback).
    const existingByExternalId = await bulkFetchExisting(client.mediaType, filtered, allMedia);

    // Phase 2 N+1 kill: collect season writes for TV updates here so we can batch them into
    // a single deleteMany+createMany after the loop instead of N upserts per TV item. The
    // create path for TV (brand-new media rows) already uses createMany inside processSingleMedia.
    const pendingSeasons: { mediaId: number; seasons: typeof filtered[number]['seasons'] }[] = [];

    for (const item of filtered) {
      try {
        const existing = existingByExternalId.get(item.externalId);
        const result = await processSingleMedia(item, client, serviceId, existing);
        if (result === 'added') added++;
        else if (result === 'updated' || result === 'merged') updated++;
        // Queue seasons for the update path only — creates already batched via createMany,
        // and the merge path writes seasons inline (its target id isn't `existing.id`).
        if (client.mediaType === 'tv' && result === 'updated' && existing && item.seasons !== undefined) {
          pendingSeasons.push({ mediaId: existing.id, seasons: item.seasons });
        }
      } catch (err) {
        errors++;
        logEvent('debug', 'Sync', `Error processing ${item.title}: ${err}`);
      }
    }

    // Single transaction replaces N upserts (~5 per TV media × 1000s of items = 5k+ queries).
    // Season is a leaf model (no child FKs), so deleteMany+createMany preserves the same final
    // state as the per-season upsert without cascading side effects.
    if (pendingSeasons.length > 0) {
      const mediaIds = pendingSeasons.map((p) => p.mediaId);
      const rows = pendingSeasons.flatMap((p) =>
        (p.seasons ?? [])
          .filter((s) => s.seasonNumber > 0)
          .map((s) => ({
            mediaId: p.mediaId,
            seasonNumber: s.seasonNumber,
            episodeCount: s.totalEpisodeCount,
            statusCategory: s.statusCategory,
          })),
      );
      await prisma.$transaction([
        prisma.season.deleteMany({ where: { mediaId: { in: mediaIds } } }),
        prisma.season.createMany({ data: rows }),
      ]);
      logEvent('debug', 'Sync', `${serviceType}: bulk-synced seasons for ${mediaIds.length} TV items (${rows.length} season rows)`);
    }

  } catch (err) {
    logEvent('error', 'Sync', `${serviceType} sync failed: ${err}`);
    errors++;
    reached = false;
  }

  const duration = Date.now() - start;
  if (added > 0 || updated > 0) {
    logEvent('info', 'Sync', `${serviceType}: +${added} added, ~${updated} updated (${duration}ms)`);
  }
  return { added, updated, errors, duration, reached };
}

/** Single bulk query replaces one findUnique/findFirst per item. Returns a Map keyed by the
 *  externalId the service uses — tmdbId for movies, tvdbId (or -(tmdbId) legacy placeholder)
 *  for TV. Absent keys = no existing row → caller creates. */
async function bulkFetchExisting(
  mediaType: 'movie' | 'tv',
  items: ArrMediaItem[],
  catalog: ArrMediaItem[],
): Promise<Map<number, Media>> {
  const map = new Map<number, Media>();
  const externalIds = items.map(item => item.externalId).filter(Number.isFinite);
  if (externalIds.length === 0) return map;

  if (mediaType === 'movie') {
    const rows = await prisma.media.findMany({
      where: { mediaType: 'movie', tmdbId: { in: externalIds } },
    });
    for (const row of rows) map.set(row.tmdbId, row);
    return map;
  }
  // A TMDB-discovered row can lack TVDB, or Sonarr can remap TVDB on an existing series.
  // Fetch exact native TMDB identities in the same query, without a per-item lookup.
  const negatives = externalIds.map((id) => -id);
  const tmdbIds = items.map(item => item.tmdbId).filter((id): id is number => Number.isSafeInteger(id) && id! > 0);
  const tmdbCounts = new Map<number, number>();
  // An incremental batch may contain just one of several native series sharing a TMDB ID.
  // Only the complete instance catalog can establish whether that fallback is unambiguous.
  for (const { tmdbId } of catalog) {
    if (Number.isSafeInteger(tmdbId) && tmdbId! > 0) {
      tmdbCounts.set(tmdbId!, (tmdbCounts.get(tmdbId!) ?? 0) + 1);
    }
  }
  const rows = await prisma.media.findMany({
    where: {
      mediaType: 'tv',
      OR: [{ tvdbId: { in: externalIds } }, { tmdbId: { in: [...negatives, ...tmdbIds] } }],
    },
  });
  for (const row of rows) {
    const key = row.tvdbId ?? -row.tmdbId;
    map.set(key, row);
  }
  const byTmdbId = new Map(rows.map(row => [row.tmdbId, row]));
  for (const item of items) {
    const canonical = item.tmdbId && tmdbCounts.get(item.tmdbId) === 1 ? byTmdbId.get(item.tmdbId) : undefined;
    // Prefer the native TVDB/placeholder path so its existing merge logic is preserved.
    if (!map.has(item.externalId) && canonical) map.set(item.externalId, canonical);
  }
  return map;
}

async function createMedia(item: ArrMediaItem, client: ArrClient, serviceId: number): Promise<void> {
  if (client.mediaType === 'movie') {
    await prisma.media.create({
      data: {
        tmdbId: item.externalId,
        mediaType: 'movie',
        title: item.title,
        posterPath: item.posterPath,
        backdropPath: item.backdropPath,
        statusCategory: item.statusCategory,
        radarrId: item.serviceMediaId,
        serviceId,
        qualityProfileId: item.qualityProfileId,
        ...(item.statusCategory === 'AVAILABLE' ? { availableAt: new Date() } : {}),
      },
    });
    return;
  }
  // TV: use Sonarr's real tmdbId when present so batch-status (keyed by positive tmdbId) matches.
  const realTmdbId = item.tmdbId && item.tmdbId > 0 ? item.tmdbId : null;
  const created = await prisma.media.create({
    data: {
      tmdbId: realTmdbId ?? -(item.externalId),
      tvdbId: item.externalId,
      mediaType: 'tv',
      title: item.title,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
      statusCategory: item.statusCategory,
      sonarrId: item.serviceMediaId,
      serviceId,
      qualityProfileId: item.qualityProfileId,
      ...(item.statusCategory === 'AVAILABLE' ? { availableAt: new Date() } : {}),
    },
  });
  if (item.seasons?.length) {
    await prisma.season.createMany({
      data: item.seasons
        .filter(s => s.seasonNumber > 0)
        .map(s => ({
          mediaId: created.id,
          seasonNumber: s.seasonNumber,
          episodeCount: s.totalEpisodeCount,
          statusCategory: s.statusCategory,
        })),
    });
  }
}

async function applyUpdate(
  existing: Media,
  updateData: Record<string, unknown>,
  becameAvailable: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.media.update({ where: { id: existing.id }, data: updateData });
    if (becameAvailable) await cascadeRequestsForCategory(existing.id, 'AVAILABLE', tx);
  });
}

/** How much a state is worth when two instances claim the same row. AVAILABLE on top: a copy that
 *  exists beats one that is still searching, whichever instance holds it. BLACKLISTED sits low so
 *  a blocked copy on one instance can't mask a real one on another. */
const STATE_RANK: Record<string, number> = {
  UNAVAILABLE: 0,
  BLACKLISTED: 1,
  UPCOMING: 2,
  SEARCHING: 3,
  PROCESSING: 4,
  AVAILABLE: 5,
};

/** Unowned, already ours, or we hold a strictly better copy than the current owner. */
function canClaimMedia(existing: Media, serviceId: number, incomingState: string): boolean {
  if (existing.serviceId == null || existing.serviceId === serviceId) return true;
  return (STATE_RANK[incomingState] ?? 0) > (STATE_RANK[existing.statusCategory] ?? 0);
}

/** Changing a known TVDB mapping requires the same TMDB identity AND the same instance-local
 *  series. Native TMDB alone may fill a missing mapping, but must not replace an unrelated one. */
function assertSeriesSyncIdentity(existing: Media, item: ArrMediaItem, serviceId: number): void {
  const tmdbId = Number.isSafeInteger(item.tmdbId) && item.tmdbId! > 0 ? item.tmdbId : null;
  if (tmdbId && existing.tmdbId > 0 && existing.tmdbId !== tmdbId) {
    throw new Error(`Conflicting TMDB identity for TVDB ${item.externalId}`);
  }
  if (existing.tvdbId && existing.tvdbId !== item.externalId
    && !(tmdbId === existing.tmdbId && existing.serviceId === serviceId && existing.sonarrId === item.serviceMediaId)) {
    throw new Error(`Conflicting TVDB identity for TMDB ${existing.tmdbId}`);
  }
}

async function processSingleMedia(
  item: ArrMediaItem,
  client: ArrClient,
  serviceId: number,
  existing: Media | undefined,
): Promise<'added' | 'updated' | 'skipped' | 'merged'> {
  if (client.mediaType === 'tv' && !item.externalId) return 'skipped';

  if (!existing) {
    await createMedia(item, client, serviceId);
    return 'added';
  }

  if (client.mediaType === 'tv') assertSeriesSyncIdentity(existing, item, serviceId);

  // One Media row per (tmdbId, mediaType), so two instances holding the same title both match it.
  // Without an owner the last one walked wins every pass and the category flips every 15 min.
  if (!canClaimMedia(existing, serviceId, item.statusCategory)) return 'skipped';

  const becameAvailable = item.statusCategory === 'AVAILABLE' && existing.statusCategory !== 'AVAILABLE';
  if (becameAvailable) {
    logEvent('debug', 'Sync', `"${item.title}" (${client.serviceType}:${item.externalId}) status: ${existing.statusCategory} -> ${item.statusCategory}`);
    sendAvailabilityNotifications(
      existing.title || item.title,
      client.mediaType,
      item.posterPath || existing.posterPath,
      existing.id,
      existing.tmdbId,
    );
  }

  const updateData: Record<string, unknown> = {
    [arrIdFieldForClient(client)]: item.serviceMediaId,
    serviceId,
    statusCategory: item.statusCategory,
    qualityProfileId: item.qualityProfileId,
    title: existing.title || item.title,
    ...(item.posterPath && !existing.posterPath ? { posterPath: item.posterPath } : {}),
    ...(item.backdropPath && !existing.backdropPath ? { backdropPath: item.backdropPath } : {}),
    ...(becameAvailable && !existing.availableAt ? { availableAt: new Date() } : {}),
  };

  // TV placeholder upgrade: try to write Sonarr's real tmdbId; fall back to merge on P2002.
  // Probe-then-act would race against findOrCreateMedia / trackKeywordsFromDetails / webhook.
  if (client.mediaType === 'tv') {
    updateData.tvdbId = item.externalId;
    const realTmdbId = existing.tmdbId < 0 && item.tmdbId && item.tmdbId > 0 ? item.tmdbId : null;
    if (realTmdbId) {
      try {
        await applyUpdate(existing, { ...updateData, tmdbId: realTmdbId }, becameAvailable);
        return 'updated';
      } catch (err) {
        if (!isTmdbMediaTypeConflict(err)) throw err;
        const canonical = await prisma.media.findFirst({
          where: { tmdbId: realTmdbId, mediaType: 'tv', NOT: { id: existing.id } },
        });
        if (!canonical) throw err;
        assertSeriesSyncIdentity(canonical, item, serviceId);
        const seasons = (item.seasons ?? []).filter((s) => s.seasonNumber > 0).map((s) => ({ seasonNumber: s.seasonNumber, episodeCount: s.totalEpisodeCount, statusCategory: s.statusCategory }));
        await mergeTvPlaceholderInto(existing, canonical.id, updateData, { seasons, becameAvailable });
        return 'merged';
      }
    }
    if (existing.tmdbId < 0) updateData.tmdbId = -(item.externalId);
  }

  await applyUpdate(existing, updateData, becameAvailable);
  return 'updated';
}
