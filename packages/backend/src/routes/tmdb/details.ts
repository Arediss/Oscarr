import type { FastifyInstance } from 'fastify';
import {
  getMovieDetails,
  getTvDetails,
  getTvSeasonDetails,
  getPersonDetails,
  getCollection,
} from '../../services/tmdb.js';
import { trackKeywordsFromDetails } from '../../services/sync/keywordSync.js';
import { parseId } from '../../utils/params.js';
import { getLang, idParamSchema } from './helpers.js';

/**
 * Single-resource lookups — movie / tv / person / collection. Each handler validates the id,
 * fetches the full details, and kicks off a background keyword-tracking update when relevant.
 */
export async function detailsRoutes(app: FastifyInstance) {
  app.get('/tv/:id/season/:seasonNumber', {
    schema: { params: {
      type: 'object', required: ['id', 'seasonNumber'],
      properties: {
        id: { type: 'integer', minimum: 1, maximum: 2147483647 },
        seasonNumber: { type: 'integer', minimum: 0, maximum: 2147483647 },
      },
    } },
  }, async (request) => {
    const { id, seasonNumber } = request.params as { id: number; seasonNumber: number };
    return getTvSeasonDetails(id, seasonNumber, getLang(request));
  });

  app.get('/movie/:id', { schema: { params: idParamSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const movieId = parseId(id);
    if (!movieId) return reply.status(400).send({ error: 'Invalid ID' });
    const details = await getMovieDetails(movieId, getLang(request));
    trackKeywordsFromDetails(movieId, 'movie', details).catch(() => { /* background */ });
    return details;
  });

  app.get('/tv/:id', { schema: { params: idParamSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tvId = parseId(id);
    if (!tvId) return reply.status(400).send({ error: 'Invalid ID' });
    const details = await getTvDetails(tvId, getLang(request));
    trackKeywordsFromDetails(tvId, 'tv', details).catch(() => { /* background */ });
    return details;
  });

  app.get('/person/:id', { schema: { params: idParamSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const personId = parseId(id);
    if (!personId) return reply.status(400).send({ error: 'Invalid ID' });
    return getPersonDetails(personId, getLang(request));
  });

  app.get('/collection/:id', { schema: { params: idParamSchema } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const collectionId = parseId(id);
    if (!collectionId) return reply.status(400).send({ error: 'Invalid ID' });
    return getCollection(collectionId, getLang(request));
  });
}
