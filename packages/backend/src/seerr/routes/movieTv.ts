import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { getMovieDetails, getTvDetails } from '../../services/tmdb.js';
import { buildSeerrMedia } from '../adapters/media.js';

/**
 * Overseerr's /movie/:tmdbId and /tv/:tmdbId endpoints proxy TMDB and stitch on a `mediaInfo`
 * block describing whether the title is already requested/processing/available locally.
 *
 * We pass the TMDB payload through verbatim (Overseerr does the same — clients depend on the
 * full TMDB shape) and only inject the Oscarr-specific `mediaInfo` field, derived from the
 * Media row keyed by (tmdbId, mediaType).
 */
export async function movieTvRoutes(app: FastifyInstance) {
  app.get<{ Params: { tmdbId: string }; Querystring: { language?: string } }>(
    '/movie/:tmdbId',
    async (request, reply) => {
      const tmdbId = Number(request.params.tmdbId);
      if (!Number.isInteger(tmdbId) || tmdbId < 1) {
        return reply.status(400).send({ error: 'INVALID_ID' });
      }

      const [tmdb, oscarrMedia] = await Promise.all([
        safeFetch(() => getMovieDetails(tmdbId, request.query.language)),
        prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId, mediaType: 'movie' } } }),
      ]);

      if (!tmdb) return reply.status(404).send({ error: 'NOT_FOUND' });
      return { ...tmdb, mediaInfo: oscarrMedia ? buildSeerrMedia(oscarrMedia) : null };
    },
  );

  app.get<{ Params: { tmdbId: string }; Querystring: { language?: string } }>(
    '/tv/:tmdbId',
    async (request, reply) => {
      const tmdbId = Number(request.params.tmdbId);
      if (!Number.isInteger(tmdbId) || tmdbId < 1) {
        return reply.status(400).send({ error: 'INVALID_ID' });
      }

      const [tmdb, oscarrMedia] = await Promise.all([
        safeFetch(() => getTvDetails(tmdbId, request.query.language)),
        prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId, mediaType: 'tv' } } }),
      ]);

      if (!tmdb) return reply.status(404).send({ error: 'NOT_FOUND' });
      return { ...tmdb, mediaInfo: oscarrMedia ? buildSeerrMedia(oscarrMedia) : null };
    },
  );
}

async function safeFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}
