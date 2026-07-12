import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { getArrClient } from '../providers/index.js';
import { parseId, parsePage, VALID_MEDIA_TYPES } from '../utils/params.js';
import { isMatureRating } from '../services/tmdb.js';
import { normalizeLanguages } from '../utils/languages.js';
import { performLiveCheckWithTimeout, cacheLanguageData, refreshMediaCategory, canSkipLiveCheck } from '../services/mediaService.js';
import { COMPLETABLE_REQUEST_STATUSES } from '@oscarr/shared';
import type { Availability } from '@oscarr/shared';
import { buildAvailability, loadBlacklistedKeys } from '../services/availability.js';
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

    const media = await prisma.media.findUnique({
      where: {
        tmdbId_mediaType: {
          tmdbId: tmdbIdNum,
          mediaType,
        },
      },
      include: {
        requests: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true } },
          },
        },
        seasons: { orderBy: { seasonNumber: 'asc' } },
      },
    });

    // ── Phase 1: DB data (fast, local) ────────────────────────────────
    const cachedAudio: string[] | null = media?.audioLanguages ? JSON.parse(media.audioLanguages) : null;
    const cachedSubs: string[] | null = media?.subtitleLanguages ? JSON.parse(media.subtitleLanguages) : null;

    // ── Phase 2: Live check Radarr/Sonarr (with timeout) ────────────
    // Skipped when DB state is fresh — pending/processing still hit to catch transitions fast.
    const skipLive = canSkipLiveCheck(media?.statusCategory, media?.availableAt ?? null);
    const liveCheck = skipLive
      ? { liveAvailable: true, sonarrSeasonStats: null, audioLanguages: null, subtitleLanguages: null, timedOut: false }
      : await performLiveCheckWithTimeout(
          mediaType, tmdbIdNum, media?.tvdbId ?? null, !!cachedAudio,
        );
    const { liveAvailable, sonarrSeasonStats, audioLanguages, subtitleLanguages } = liveCheck;

    // ── Phase 3: Assemble response ──────────────────────────────────
    if (!media) {
      const result: Record<string, unknown> = { exists: false };
      if (liveAvailable) result.statusCategory = 'AVAILABLE';
      if (sonarrSeasonStats) result.sonarrSeasons = sonarrSeasonStats;
      if (liveAvailable) result.inLibrary = true;
      if (audioLanguages) result.audioLanguages = normalizeLanguages(audioLanguages);
      if (subtitleLanguages) result.subtitleLanguages = normalizeLanguages(subtitleLanguages);
      return result;
    }

    // Apply live check side-effects only when we got a real response
    let finalAudio = cachedAudio;
    let finalSubs = cachedSubs;
    if (!liveCheck.timedOut) {
      if ((audioLanguages || subtitleLanguages) && !cachedAudio) {
        await cacheLanguageData(media.id, audioLanguages, subtitleLanguages);
      }
      finalAudio = (audioLanguages ? normalizeLanguages(audioLanguages) : null) || cachedAudio;
      finalSubs = (subtitleLanguages ? normalizeLanguages(subtitleLanguages) : null) || cachedSubs;

      const refreshedCat = await refreshMediaCategory(media);
      if (refreshedCat && refreshedCat !== media.statusCategory) {
        media.statusCategory = refreshedCat;
        if (refreshedCat === 'AVAILABLE') {
          media.requests = media.requests.map((r) =>
            (COMPLETABLE_REQUEST_STATUSES as readonly string[]).includes(r.status) ? { ...r, status: 'available' } : r
          );
        } else if (refreshedCat === 'PROCESSING') {
          media.requests = media.requests.map((r) =>
            ['approved', 'failed'].includes(r.status) ? { ...r, status: 'processing' } : r
          );
        }
      }
    }

    const activeQualityOptionIds: number[] = [];
    if ((media.statusCategory === 'AVAILABLE' || liveAvailable) && media.qualityProfileId) {
      const mappings = await prisma.qualityMapping.findMany({
        where: { qualityProfileId: media.qualityProfileId },
        select: { qualityOptionId: true },
      });
      activeQualityOptionIds.push(...[...new Set(mappings.map(m => m.qualityOptionId))]);
    }

    const result: Record<string, unknown> = { ...media };
    if (sonarrSeasonStats) result.sonarrSeasons = sonarrSeasonStats;
    if (liveAvailable) result.inLibrary = true;
    if (activeQualityOptionIds.length > 0) result.activeQualityOptionIds = activeQualityOptionIds;
    if (finalAudio) result.audioLanguages = finalAudio;
    if (finalSubs) result.subtitleLanguages = finalSubs;
    if (media.contentRating && isMatureRating(media.contentRating)) result.nsfw = true;
    return result;
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

    for (const m of media) {
      const key = mediaKey(m);
      results[key] = buildAvailability(m, m.requests[0] ?? null, blacklistedKeys);
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
      const client = await getArrClient('sonarr');
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

    const nsfwKeywords = await prisma.keyword.findMany({
      where: { tag: 'nsfw' },
      select: { tmdbId: true },
    });
    if (nsfwKeywords.length > 0) {
      // Integer IDs from a trusted DB column — safe to interpolate.
      const idList = nsfwKeywords.map((k) => k.tmdbId).join(',');
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
  nsfwIdsCache = null;
}
