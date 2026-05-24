import { prisma } from '../../utils/prisma.js';
import { getArrClient } from '../../providers/index.js';
import type { ArrClient, ArrMediaItem } from '../../providers/types.js';
import { getServiceConfig } from '../../utils/services.js';
import { logEvent } from '../../utils/logEvent.js';
import type { SyncResult } from './helpers.js';
import { sendAvailabilityNotifications } from './helpers.js';
import { COMPLETABLE_REQUEST_STATUSES } from '@oscarr/shared';
import { transitionRequestStatus } from '../requestStatusTransition.js';
import type { Media } from '@prisma/client';

export async function syncArrService(serviceType: string, since?: Date | null): Promise<SyncResult> {
  const start = Date.now();
  let added = 0, updated = 0, errors = 0;

  const config = await getServiceConfig(serviceType);
  if (!config) {
    logEvent('debug', 'Sync', `${serviceType}: no service configured, skipping`);
    return { added: 0, updated: 0, errors: 0, duration: 0 };
  }

  try {
    const client = await getArrClient(serviceType);
    const allMedia = await client.getAllMedia();

    let filtered = allMedia;
    if (since) {
      const newlyAdded = allMedia.filter(m => m.addedDate && new Date(m.addedDate) > since);
      // Items with file that aren't marked available in DB
      const availableItems = allMedia.filter(m => m.status === 'available');
      const availableExternalIds = new Set(availableItems.map(m => m.externalId));

      const notAvailableInDb = await prisma.media.findMany({
        where: { mediaType: client.mediaType, status: { in: ['unknown', 'pending', 'searching', 'processing', 'upcoming'] } },
        select: { tmdbId: true, tvdbId: true },
      });

      const needsUpdateIds = new Set<number>();
      for (const row of notAvailableInDb) {
        const id = client.mediaType === 'movie' ? row.tmdbId : (row.tvdbId ?? row.tmdbId);
        if (availableExternalIds.has(id)) needsUpdateIds.add(id);
      }

      const toUpdate = availableItems.filter(m => needsUpdateIds.has(m.externalId));
      const combined = new Map<number, ArrMediaItem>();
      for (const m of [...newlyAdded, ...toUpdate]) combined.set(m.externalId, m);
      filtered = [...combined.values()];

      if (needsUpdateIds.size > 0) {
        logEvent('debug', 'Sync', `${serviceType} incremental: ${newlyAdded.length} newly added, ${toUpdate.length} need status update`);
      }
    }

    logEvent('debug', 'Sync', `${serviceType}: ${filtered.length} items to process (${since ? 'incremental' : 'full scan'})`);

    // Bulk-fetch existing media for every externalId in one query — the previous per-item
    // findUnique/findFirst was the dominant N+1 cost (10k items → 10k round-trips). Build a
    // Map keyed by the external ID the service speaks (tmdbId for movies, tvdbId for TV with
    // legacy -(tmdbId) placeholders as a fallback).
    const externalIds = filtered.map((i) => i.externalId).filter((id): id is number => Number.isFinite(id));
    const existingByExternalId = await bulkFetchExisting(client.mediaType, externalIds);

    // Phase 2 N+1 kill: collect season writes for TV updates here so we can batch them into
    // a single deleteMany+createMany after the loop instead of N upserts per TV item. The
    // create path for TV (brand-new media rows) already uses createMany inside processSingleMedia.
    const pendingSeasons: { mediaId: number; seasons: typeof filtered[number]['seasons'] }[] = [];

    for (const item of filtered) {
      try {
        const existing = existingByExternalId.get(item.externalId);
        const result = await processSingleMedia(item, client, existing);
        if (result === 'added') added++;
        else if (result === 'updated' || result === 'merged') updated++;
        // Queue seasons for the update path only — creates already batched via createMany,
        // and the merge path writes seasons inline (its target id isn't `existing.id`).
        if (client.mediaType === 'tv' && result === 'updated' && existing && item.seasons?.length) {
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
            status: s.status,
          })),
      );
      await prisma.$transaction([
        prisma.season.deleteMany({ where: { mediaId: { in: mediaIds } } }),
        prisma.season.createMany({ data: rows }),
      ]);
      logEvent('debug', 'Sync', `${serviceType}: bulk-synced seasons for ${mediaIds.length} TV items (${rows.length} season rows)`);
    }

    // Update last sync timestamp
    const syncField = client.mediaType === 'movie' ? 'lastRadarrSync' : 'lastSonarrSync';
    await prisma.appSettings.upsert({
      where: { id: 1 },
      update: { [syncField]: new Date() },
      create: { id: 1, [syncField]: new Date(), updatedAt: new Date() },
    });
  } catch (err) {
    logEvent('error', 'Sync', `${serviceType} sync failed: ${err}`);
    errors++;
  }

  const duration = Date.now() - start;
  if (added > 0 || updated > 0) {
    logEvent('info', 'Sync', `${serviceType}: +${added} added, ~${updated} updated (${duration}ms)`);
  }
  return { added, updated, errors, duration };
}

/** Single bulk query replaces one findUnique/findFirst per item. Returns a Map keyed by the
 *  externalId the service uses — tmdbId for movies, tvdbId (or -(tmdbId) legacy placeholder)
 *  for TV. Absent keys = no existing row → caller creates. */
async function bulkFetchExisting(
  mediaType: 'movie' | 'tv',
  externalIds: number[],
): Promise<Map<number, Media>> {
  const map = new Map<number, Media>();
  if (externalIds.length === 0) return map;

  if (mediaType === 'movie') {
    const rows = await prisma.media.findMany({
      where: { mediaType: 'movie', tmdbId: { in: externalIds } },
    });
    for (const row of rows) map.set(row.tmdbId, row);
    return map;
  }
  // TV: a row matches either its tvdbId OR a legacy negative-tmdbId placeholder. Single query
  // covers both via OR clause — Prisma folds it into one WHERE.
  const negatives = externalIds.map((id) => -id);
  const rows = await prisma.media.findMany({
    where: {
      mediaType: 'tv',
      OR: [{ tvdbId: { in: externalIds } }, { tmdbId: { in: negatives } }],
    },
  });
  for (const row of rows) {
    const key = row.tvdbId ?? -row.tmdbId;
    map.set(key, row);
  }
  return map;
}

/** True iff the error is a P2002 unique-constraint violation on `(tmdbId, mediaType)`. */
function isTmdbMediaTypeConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('tmdbId') && target.includes('mediaType');
  return typeof target === 'string' && target.includes('tmdbId');
}

async function createMedia(item: ArrMediaItem, client: ArrClient): Promise<void> {
  if (client.mediaType === 'movie') {
    await prisma.media.create({
      data: {
        tmdbId: item.externalId,
        mediaType: 'movie',
        title: item.title,
        posterPath: item.posterPath,
        backdropPath: item.backdropPath,
        status: item.status,
        radarrId: item.serviceMediaId,
        qualityProfileId: item.qualityProfileId,
        ...(item.status === 'available' ? { availableAt: new Date() } : {}),
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
      status: item.status,
      sonarrId: item.serviceMediaId,
      qualityProfileId: item.qualityProfileId,
      ...(item.status === 'available' ? { availableAt: new Date() } : {}),
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
          status: s.status,
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
    if (becameAvailable) {
      await transitionRequestStatus(
        { requestId: undefined, from: undefined, to: 'available', why: 'cascade-media-available' },
        () => tx.mediaRequest.updateMany({
          where: { mediaId: existing.id, status: { in: [...COMPLETABLE_REQUEST_STATUSES] } },
          data: { status: 'available' },
        }),
      );
    }
  });
}

/** Merge a placeholder TV row into the canonical positive-tmdbId row, deleting the placeholder.
 *  Dedups requests by userId so re-parenting doesn't multiply rows when both sides already had
 *  one for the same user. Atomic: races on the unique key are resolved by retrying merge from
 *  the caller's catch, never by leaving the DB partially merged. */
async function mergeIntoCanonical(
  placeholder: Media,
  canonicalId: number,
  item: ArrMediaItem,
  updateData: Record<string, unknown>,
  becameAvailable: boolean,
): Promise<void> {
  const seasonRows = (item.seasons ?? [])
    .filter((s) => s.seasonNumber > 0)
    .map((s) => ({
      mediaId: canonicalId,
      seasonNumber: s.seasonNumber,
      episodeCount: s.totalEpisodeCount,
      status: s.status,
    }));
  const { tmdbId: _drop, ...mergeData } = updateData;

  await prisma.$transaction(async (tx) => {
    const canonicalRequesters = await tx.mediaRequest.findMany({
      where: { mediaId: canonicalId },
      select: { userId: true },
    });
    const dupUserIds = canonicalRequesters.map((r) => r.userId);
    if (dupUserIds.length > 0) {
      await tx.mediaRequest.deleteMany({
        where: { mediaId: placeholder.id, userId: { in: dupUserIds } },
      });
    }
    await tx.mediaRequest.updateMany({ where: { mediaId: placeholder.id }, data: { mediaId: canonicalId } });
    await tx.season.deleteMany({ where: { mediaId: placeholder.id } });
    await tx.media.delete({ where: { id: placeholder.id } });
    await tx.media.update({ where: { id: canonicalId }, data: mergeData });
    if (seasonRows.length > 0) {
      await tx.season.deleteMany({ where: { mediaId: canonicalId } });
      await tx.season.createMany({ data: seasonRows });
    }
    if (becameAvailable) {
      await transitionRequestStatus(
        { requestId: undefined, from: undefined, to: 'available', why: 'cascade-media-available-merge' },
        () => tx.mediaRequest.updateMany({
          where: { mediaId: canonicalId, status: { in: [...COMPLETABLE_REQUEST_STATUSES] } },
          data: { status: 'available' },
        }),
      );
    }
  });
  logEvent('debug', 'Sync', `Merged placeholder TV row ${placeholder.id} into canonical row ${canonicalId} (tvdb:${item.externalId})`);
}

async function processSingleMedia(
  item: ArrMediaItem,
  client: ArrClient,
  existing: Media | undefined,
): Promise<'added' | 'updated' | 'skipped' | 'merged'> {
  if (client.mediaType === 'tv' && !item.externalId) return 'skipped';

  if (!existing) {
    await createMedia(item, client);
    return 'added';
  }

  const becameAvailable = item.status === 'available' && existing.status !== 'available';
  if (becameAvailable) {
    logEvent('debug', 'Sync', `"${item.title}" (${client.serviceType}:${item.externalId}) status: ${existing.status} -> ${item.status}`);
    sendAvailabilityNotifications(
      existing.title || item.title,
      client.mediaType,
      item.posterPath || existing.posterPath,
      existing.id,
      existing.tmdbId,
    );
  }

  const updateData: Record<string, unknown> = {
    [client.dbIdField]: item.serviceMediaId,
    status: item.status,
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
          select: { id: true },
        });
        if (!canonical) throw err;
        await mergeIntoCanonical(existing, canonical.id, item, updateData, becameAvailable);
        return 'merged';
      }
    }
    if (existing.tmdbId < 0) updateData.tmdbId = -(item.externalId);
  }

  await applyUpdate(existing, updateData, becameAvailable);
  return 'updated';
}
