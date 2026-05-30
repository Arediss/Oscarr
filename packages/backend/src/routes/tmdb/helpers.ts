import type { FastifyRequest } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { parsePage } from '../../utils/params.js';
import { getMovieDetails, getTvDetails, isMatureRating } from '../../services/tmdb.js';
import { trackKeywordsFromDetails } from '../../services/sync/keywordSync.js';
import { mediaKey } from '../../utils/mediaKey.js';

export const pageQuerySchema = {
  type: 'object' as const,
  properties: {
    page: { type: 'string', description: 'Page number for pagination (defaults to 1)' },
  },
};

export const idParamSchema = {
  type: 'object' as const,
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'TMDB resource ID' },
  },
};

/** Primary language from Accept-Language header, ISO 639-1. Falls back to 'en'. */
export function getLang(request: FastifyRequest): string {
  return (request.headers['accept-language'] || '').split(',')[0]?.split('-')[0] || 'en';
}

/**
 * Check NSFW status for a page of TMDB results — DB first (fast path), TMDB fallback for
 * unknown items (background hydration). Returns NSFW tmdb ids from DB synchronously; items
 * not in DB get their NSFW status populated in the background for the next request.
 */
export async function flagNsfwFromDb(
  results: { id: number; media_type?: string; title?: string; name?: string }[],
  defaultMediaType: 'movie' | 'tv',
  lang?: string,
): Promise<number[]> {
  const items = results.slice(0, 20)
    .filter(r => {
      const mt = r.media_type || (r.name ? 'tv' : r.title ? 'movie' : defaultMediaType);
      return mt === 'movie' || mt === 'tv';
    })
    .map(r => ({
      tmdbId: r.id,
      mediaType: (r.media_type === 'movie' || r.media_type === 'tv')
        ? r.media_type
        : (r.name ? 'tv' as const : 'movie' as const),
    }));
  if (items.length === 0) return [];

  const nsfwKeywords = await prisma.keyword.findMany({ where: { tag: 'nsfw' }, select: { tmdbId: true } });
  const nsfwKwSet = new Set(nsfwKeywords.map(k => k.tmdbId));

  const METADATA_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
  const mediaRows = await prisma.media.findMany({
    where: { OR: items.map(i => ({ tmdbId: i.tmdbId, mediaType: i.mediaType })) },
    select: { tmdbId: true, mediaType: true, keywordIds: true, contentRating: true, updatedAt: true },
  });

  const nsfwIds: number[] = [];
  const foundTmdbIds = new Set(mediaRows.map(mediaKey));
  const now = Date.now();
  const stale: typeof items = [];

  for (const row of mediaRows) {
    if (isMatureRating(row.contentRating)) {
      nsfwIds.push(row.tmdbId);
    } else if (row.keywordIds && nsfwKwSet.size > 0) {
      try {
        const kwIds: number[] = JSON.parse(row.keywordIds);
        if (kwIds.some(id => nsfwKwSet.has(id))) {
          nsfwIds.push(row.tmdbId);
        }
      } catch { /* malformed row, skip — logged upstream on write */ }
    }
    if (now - new Date(row.updatedAt).getTime() > METADATA_TTL || row.keywordIds === null) {
      stale.push({ tmdbId: row.tmdbId, mediaType: row.mediaType as 'movie' | 'tv' });
    }
  }

  const missing = [
    ...items.filter(i => !foundTmdbIds.has(mediaKey(i))),
    ...stale,
  ];
  if (missing.length > 0 && lang) {
    void Promise.allSettled(
      missing.map(async (item) => {
        const details = item.mediaType === 'movie'
          ? await getMovieDetails(item.tmdbId, lang)
          : await getTvDetails(item.tmdbId, lang);
        await trackKeywordsFromDetails(item.tmdbId, item.mediaType, details).catch(() => { /* background hydration */ });
      }),
    );
  }

  return nsfwIds;
}

type ListLikeResponse = {
  results?: { id: number; media_type?: string; title?: string; name?: string }[];
  [k: string]: unknown;
};

type ListFetcher = (args: { page: number; lang: string }) => Promise<ListLikeResponse>;

/**
 * Run a paginated TMDB "list" endpoint the same way every time: parse page + language from the
 * request, call the fetcher, flag NSFW ids from the DB, return the merged payload.
 *
 * NSFW flagging is best-effort — a failed check should never 500 the whole list, so we swallow
 * and return an empty nsfw id array. Any NSFW-cache anomaly gets logged downstream.
 */
export async function fetchList(
  request: FastifyRequest,
  fetcher: ListFetcher,
  defaultMediaType: 'movie' | 'tv',
): Promise<ListLikeResponse & { nsfwTmdbIds: number[] }> {
  const { page } = request.query as { page?: string };
  const lang = getLang(request);
  const data = await fetcher({ page: parsePage(page), lang });
  const nsfwTmdbIds = await flagNsfwFromDb(data.results || [], defaultMediaType, lang).catch((err) => {
    // NSFW flagging shouldn't 500 the list response, but a consistent failure here means
    // mature content would silently leak through to the UI — log it so a prisma outage or a
    // schema drift leaves a trail instead of degrading to zero flags without anyone noticing.
    request.log.warn({ err }, 'NSFW flag check failed — returning empty nsfwTmdbIds');
    return [];
  });
  return { ...data, nsfwTmdbIds };
}
