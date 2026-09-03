import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { getNsfwKeywordIds, invalidateNsfwKeywordIds } from '../utils/nsfwKeywords.js';
import { getArrClientForMedia } from '../providers/index.js';
import { parseId, parsePage, VALID_MEDIA_TYPES } from '../utils/params.js';
import { isMatureRating } from '../services/tmdb.js';
import { normalizeLanguages } from '../utils/languages.js';
import { performLiveCheckWithTimeout, cacheLanguageData, refreshMediaCategory, canSkipLiveCheck } from '../services/mediaService.js';
import { COMPLETABLE_REQUEST_STATUSES } from '@oscarr/shared';
import type { Availability } from '@oscarr/shared';
import { buildAvailability, loadBlacklistedKeys, loadLibraryGate, loadFreeQualityMediaIds, gateCategory, recentLibraryFilter } from '../services/availability.js';
import { mediaKey } from '../utils/mediaKey.js';

/** Normalize lastEpisodeInfo — handles both old (raw Sonarr) and new (normalized) formats */
function parseEpisodeInfo(raw: string): { season: number; episode: number; title: string } | null {
  try {
    const info = JSON.parse(raw);
    const season = info.season ?? info.seasonNumber;
    const episode = info.episode ?? info.episodeNumber;
    if (season == null || episode == null) return null;
    return { season: Number(season), episode: Number(episode), title: String(info.title || '') };
  } catch { return null; }
}

export async function mediaRoutes(app: FastifyInstance) {
  app.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page number for pagination' },
          mediaType: { type: 'string', description: 'Filter by media type (movie or tv)' },
          status: { type: 'string', description: 'Filter by media status' },
        },
      },
    },

  }, async (request) => {
    const { page, mediaType, status } = request.query as {
      page?: string;
      mediaType?: string;
      status?: string;
    };
    const pageNum = parsePage(page);
    const take = 20;
    const skip = (pageNum - 1) * take;

    const where: Record<string, unknown> = {};
    if (mediaType && VALID_MEDIA_TYPES.includes(mediaType)) where.mediaType = mediaType;
    if (status) where.statusCategory = status;

    const [media, total] = await Promise.all([
      prisma.media.findMany({
        where,
        include: {
          requests: {
            include: {
              user: { select: { id: true, displayName: true, avatar: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          seasons: { orderBy: { seasonNumber: 'asc' } },
        },
        orderBy: { updatedAt: 'desc' },
        take,
        skip,
      }),
      prisma.media.count({ where }),
    ]);

    return {
      results: media,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / take),
    };
  });

  app.get('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Media ID' },
        },
      },
    },

  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const mediaId = parseId(id);
    if (!mediaId) return reply.status(400).send({ error: 'Invalid ID' });

    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      include: {
        requests: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true } },
            approvedBy: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        seasons: { orderBy: { seasonNumber: 'asc' } },
      },
    });

    if (!media) return reply.status(404).send({ error: 'Media not found' });
    return media;
  });

  app.get('/tmdb/:tmdbId/:mediaType', {
    schema: {
      params: {
        type: 'object',
        required: ['tmdbId', 'mediaType'],
        properties: {
          tmdbId: { type: 'string', description: 'TMDB ID of the media' },
          mediaType: { type: 'string', description: 'Type of media (movie or tv)' },
        },
      },
    },

  }, async (request, reply) => {
    const { tmdbId, mediaType } = request.params as { tmdbId: string; mediaType: string };
    const tmdbIdNum = parseId(tmdbId);
    if (!tmdbIdNum) return reply.status(400).send({ error: 'Invalid tmdbId' });
    if (!VALID_MEDIA_TYPES.includes(mediaType)) return reply.status(400).send({ error: 'Invalid mediaType' });

    const media = await loadDetailMedia(tmdbIdNum, mediaType);

    // ── Phase 1: DB data (fast, local) ────────────────────────────────
    const cachedAudio = parseLanguages(media?.audioLanguages);
    const cachedSubs = parseLanguages(media?.subtitleLanguages);

    // ── Phase 2: Live check Radarr/Sonarr (with timeout) ────────────
    // Skipped when DB state is fresh — pending/processing still hit to catch transitions fast.
    const live = canSkipLiveCheck(media?.statusCategory, media?.availableAt ?? null)
      ? { liveAvailable: true, sonarrSeasonStats: null, audioLanguages: null, subtitleLanguages: null, timedOut: false }
      : await performLiveCheckWithTimeout(
          mediaType, tmdbIdNum, media?.tvdbId ?? null, !!cachedAudio, media?.serviceId ?? null,
        );

    // ── Phase 3: Assemble response ──────────────────────────────────
    if (!media) return buildUntrackedResponse(live);

    const languages = await applyLiveCheckSideEffects(media, live, cachedAudio, cachedSubs);
    return assembleDetailResponse(media, live, languages, await resolveActiveQualityOptions(media, live.liveAvailable));
  });

  // Recently added media (from Radarr/Sonarr sync)
  app.get('/recent', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string', description: 'Maximum number of results (default 20, max 50)' },
        },
      },
    },

  }, async (request) => {
    const { limit } = request.query as { limit?: string };
    const take = Math.min(Number.parseInt(limit || '20', 10) || 20, 50);

    const media = await prisma.media.findMany({
      where: {
        tmdbId: { gt: 0 },
        statusCategory: 'AVAILABLE',
        availableAt: { not: null },
        // When the admin requires library confirmation, an unconfirmed title is not "recently
        // added" from the user's point of view — their player cannot open it.
        ...(await recentLibraryFilter()),
        OR: [
          { radarrId: { not: null } },
          { sonarrId: { not: null } },
        ],
      },
      orderBy: { availableAt: 'desc' },
      take,
      select: {
        tmdbId: true,
        mediaType: true,
        title: true,
        posterPath: true,
        backdropPath: true,
        releaseDate: true,
        voteAverage: true,
        statusCategory: true,
        lastEpisodeInfo: true,
      },
    });

    return media.map((m) => ({
      ...m,
      lastEpisodeInfo: m.lastEpisodeInfo ? parseEpisodeInfo(m.lastEpisodeInfo) : null,
    }));
  });

  /**
   * The criteria a requester may pick from.
   *
   * Only those the admin marked visible: the others exist purely to drive folder rules and are
   * none of a user's business. Values come along so the picker needs a single call.
   */
  app.get('/request-criteria', async () => prisma.requestCriterion.findMany({
    where: { showOnRequest: true },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      values: { orderBy: { position: 'asc' }, select: { id: true, label: true } },
    },
  }));

  // Batch lookup: check availability for multiple TMDB IDs
  app.post('/batch-status', {
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            description: 'Array of TMDB IDs with media types to check status for (max 50)',
            items: {
              type: 'object',
              required: ['tmdbId', 'mediaType'],
              properties: {
                tmdbId: { type: 'number', description: 'TMDB ID' },
                mediaType: { type: 'string', description: 'Media type (movie or tv)' },
              },
            },
          },
        },
      },
    },

  }, async (request, reply) => {
    const { ids } = request.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: 'ids required (array of {tmdbId, mediaType})' });
    }

    // Limit to 50 per request
    const limited = ids.slice(0, 50) as { tmdbId: number; mediaType: string }[];

    // Single wire-Availability builder.
    const results: Record<string, Availability> = {};
    const blacklistedKeys = await loadBlacklistedKeys(limited);

    const userId = request.user?.id;
    const media = await prisma.media.findMany({
      where: {
        OR: limited.map((item) => ({
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
        })),
      },
      include: {
        // current user's own latest request (matches the detail page, not the latest global one)
        requests: {
          where: userId ? { userId } : undefined,
          select: { id: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Both resolved once per batch rather than per row.
    const gate = await loadLibraryGate();
    const freeQuality = await loadFreeQualityMediaIds(media.map((m) => m.id));
    for (const m of media) {
      const key = mediaKey(m);
      results[key] = buildAvailability(m, m.requests[0] ?? null, blacklistedKeys, gate, freeQuality);
    }

    return results;
  });

  // Get episodes for a season from Sonarr
  app.get('/episodes', {
    schema: {
      querystring: {
        type: 'object',
        required: ['tmdbId', 'seasonNumber'],
        properties: {
          tmdbId: { type: 'string', description: 'TMDB ID of the TV series' },
          seasonNumber: { type: 'string', description: 'Season number' },
        },
      },
    },

  }, async (request, reply) => {
    const { tmdbId, seasonNumber } = request.query as { tmdbId: string; seasonNumber: string };
    const tmdbIdNum = parseId(tmdbId);
    const seasonNum = Number.parseInt(seasonNumber, 10);
    if (!tmdbIdNum || Number.isNaN(seasonNum)) return reply.status(400).send({ error: 'Invalid parameters' });

    // Find the media in our DB to get sonarrId
    const media = await prisma.media.findUnique({
      where: { tmdbId_mediaType: { tmdbId: tmdbIdNum, mediaType: 'tv' } },
    });

    if (!media?.sonarrId) {
      return reply.status(404).send({ error: 'Series not found in Sonarr' });
    }

    try {
      const client = await getArrClientForMedia('sonarr', media.serviceId);
      if (!client.getEpisodesNormalized) return reply.status(400).send({ error: 'This service does not support episodes' });
      return await client.getEpisodesNormalized(media.sonarrId, seasonNum);
    } catch {
      return reply.status(502).send({ error: 'Unable to reach Sonarr' });
    }
  });

  /** TMDB IDs of NSFW media (mature rating or admin nsfw keyword tag). 5min cache. */
  app.get('/nsfw-ids', async () => {
    const cached = getNsfwIdsCache();
    if (cached) return cached;

    const nsfwIds = new Set<number>();

    const ratedMedia = await prisma.media.findMany({
      where: { contentRating: { not: null } },
      select: { tmdbId: true, contentRating: true },
    });
    for (const m of ratedMedia) {
      if (isMatureRating(m.contentRating)) nsfwIds.add(m.tmdbId);
    }

    const nsfwKeywordIds = await getNsfwKeywordIds();
    if (nsfwKeywordIds.size > 0) {
      // Integer IDs from a trusted DB column — safe to interpolate.
      const idList = [...nsfwKeywordIds].join(',');
      const matching = await prisma.$queryRawUnsafe<{ tmdbId: number }[]>(
        `SELECT DISTINCT m.tmdbId
         FROM Media m, json_each(m.keywordIds)
         WHERE m.keywordIds IS NOT NULL
           AND CAST(json_each.value AS INTEGER) IN (${idList})`
      );
      for (const row of matching) nsfwIds.add(row.tmdbId);
    }

    const result = [...nsfwIds];
    setNsfwIdsCache(result);
    return result;
  });
}

let nsfwIdsCache: { data: number[]; expiresAt: number } | null = null;
const NSFW_CACHE_TTL_MS = 5 * 60 * 1000;

function getNsfwIdsCache(): number[] | null {
  if (!nsfwIdsCache || Date.now() > nsfwIdsCache.expiresAt) return null;
  return nsfwIdsCache.data;
}

function setNsfwIdsCache(data: number[]): void {
  nsfwIdsCache = { data, expiresAt: Date.now() + NSFW_CACHE_TTL_MS };
}

export function invalidateNsfwIdsCache(): void {
  invalidateNsfwKeywordIds();
  nsfwIdsCache = null;
}

// ─── Detail route helpers ───────────────────────────────────────────

function loadDetailMedia(tmdbId: number, mediaType: string) {
  return prisma.media.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    include: {
      requests: { include: { user: { select: { id: true, displayName: true, avatar: true } } } },
      seasons: { orderBy: { seasonNumber: 'asc' } },
    },
  });
}

type DetailMedia = NonNullable<Awaited<ReturnType<typeof loadDetailMedia>>>;
type LiveCheck = Awaited<ReturnType<typeof performLiveCheckWithTimeout>>;

function parseLanguages(raw: string | null | undefined): string[] | null {
  return raw ? JSON.parse(raw) as string[] : null;
}

/** Media Oscarr has never tracked: the *arr may still hold it, so report what the live check saw. */
function buildUntrackedResponse(live: LiveCheck): Record<string, unknown> {
  const result: Record<string, unknown> = { exists: false };
  if (live.liveAvailable) {
    result.statusCategory = 'AVAILABLE';
    result.inLibrary = true;
  }
  if (live.sonarrSeasonStats) result.sonarrSeasons = live.sonarrSeasonStats;
  if (live.audioLanguages) result.audioLanguages = normalizeLanguages(live.audioLanguages);
  if (live.subtitleLanguages) result.subtitleLanguages = normalizeLanguages(live.subtitleLanguages);
  return result;
}

/** A category change has to carry its requests with it, or the page shows an available title
 *  above a request still labelled "approved". */
function syncRequestStatuses(media: DetailMedia, category: string): void {
  if (category === 'AVAILABLE') {
    media.requests = media.requests.map((r) =>
      (COMPLETABLE_REQUEST_STATUSES as readonly string[]).includes(r.status) ? { ...r, status: 'available' } : r
    );
  } else if (category === 'PROCESSING') {
    media.requests = media.requests.map((r) =>
      ['approved', 'failed'].includes(r.status) ? { ...r, status: 'processing' } : r
    );
  }
}

/** Applied only when the *arr actually answered: a timeout must not be read as "nothing there". */
async function applyLiveCheckSideEffects(
  media: DetailMedia,
  live: LiveCheck,
  cachedAudio: string[] | null,
  cachedSubs: string[] | null,
): Promise<{ audio: string[] | null; subs: string[] | null }> {
  if (live.timedOut) return { audio: cachedAudio, subs: cachedSubs };

  if ((live.audioLanguages || live.subtitleLanguages) && !cachedAudio) {
    await cacheLanguageData(media.id, live.audioLanguages, live.subtitleLanguages);
  }

  const refreshedCat = await refreshMediaCategory(media);
  if (refreshedCat && refreshedCat !== media.statusCategory) {
    media.statusCategory = refreshedCat;
    syncRequestStatuses(media, refreshedCat);
  }

  return {
    audio: (live.audioLanguages ? normalizeLanguages(live.audioLanguages) : null) || cachedAudio,
    subs: (live.subtitleLanguages ? normalizeLanguages(live.subtitleLanguages) : null) || cachedSubs,
  };
}

/** Which request-time quality options this media's *arr profile satisfies. */
async function resolveActiveQualityOptions(media: DetailMedia, liveAvailable: boolean): Promise<number[]> {
  if ((media.statusCategory !== 'AVAILABLE' && !liveAvailable) || !media.qualityProfileId) return [];
  const mappings = await prisma.qualityMapping.findMany({
    where: { qualityProfileId: media.qualityProfileId },
    select: { qualityOptionId: true },
  });
  return [...new Set(mappings.map((m) => m.qualityOptionId))];
}

async function assembleDetailResponse(
  media: DetailMedia,
  live: LiveCheck,
  languages: { audio: string[] | null; subs: string[] | null },
  activeQualityOptionIds: number[],
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...media };
  // Same threshold as the batch endpoint — a detail page saying "Available" while the grid says
  // otherwise would be worse than either answer on its own.
  result.statusCategory = gateCategory(media.statusCategory, media.mediaType, media.libraryConfirmedAt, await loadLibraryGate());
  if (live.sonarrSeasonStats) result.sonarrSeasons = live.sonarrSeasonStats;
  if (live.liveAvailable) result.inLibrary = true;
  if (activeQualityOptionIds.length > 0) result.activeQualityOptionIds = activeQualityOptionIds;
  if (languages.audio) result.audioLanguages = languages.audio;
  if (languages.subs) result.subtitleLanguages = languages.subs;
  if (media.contentRating && isMatureRating(media.contentRating)) result.nsfw = true;
  return result;
}
