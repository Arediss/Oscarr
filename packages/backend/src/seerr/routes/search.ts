import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { searchMulti } from '../../services/tmdb.js';
import { buildSeerrMedia } from '../adapters/media.js';

interface TmdbResultLite {
  id: number;
  media_type: string;
  [key: string]: unknown;
}

/**
 * Mirror of Overseerr's `/search?query=...` endpoint. Wraps Oscarr's TMDB multi-search and
 * injects each result with the local `mediaInfo` block (null when the title isn't in Oscarr's
 * library). Apps like Doplarr / Maintainerr branch on `mediaInfo.status` to decide whether to
 * propose a request or surface availability.
 */
export async function searchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { query?: string; page?: string; language?: string } }>(
    '/search',
    async (request, reply) => {
      const query = (request.query.query ?? '').trim();
      if (!query) return reply.status(400).send({ error: 'QUERY_REQUIRED' });

      const page = clampInt(request.query.page, 1, 1, 1000);
      const tmdb = await searchMulti(query, page, request.query.language);
      const results = (tmdb.results ?? []) as TmdbResultLite[];

      // Batch-load every (tmdbId, mediaType) we found so we don't issue N queries inside the loop.
      const tmdbIds = new Set<number>();
      for (const r of results) if (r.media_type === 'movie' || r.media_type === 'tv') tmdbIds.add(r.id);
      const mediaRows = tmdbIds.size === 0
        ? []
        : await prisma.media.findMany({
            where: { tmdbId: { in: [...tmdbIds] }, mediaType: { in: ['movie', 'tv'] } },
          });
      const mediaByKey = new Map(mediaRows.map((m) => [`${m.mediaType}:${m.tmdbId}`, m]));

      return {
        page: tmdb.page ?? page,
        totalPages: tmdb.total_pages ?? 1,
        totalResults: tmdb.total_results ?? results.length,
        results: results.map((r) => {
          const local = (r.media_type === 'movie' || r.media_type === 'tv')
            ? mediaByKey.get(`${r.media_type}:${r.id}`)
            : null;
          return { ...r, mediaInfo: local ? buildSeerrMedia(local) : null };
        }),
      };
    },
  );
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
