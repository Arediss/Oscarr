import type { FastifyInstance } from 'fastify';
import { getSeriesCatalog, getSeriesEpisodes, SeriesCatalogError } from '../services/seriesCatalog.js';
import { getServiceMetadata } from '../services/serviceMetadata.js';

const id = { type: 'integer', minimum: 1, maximum: 2147483647 };

export async function seriesCatalogRoutes(app: FastifyInstance) {
  app.get('/:mediaType/:id/metadata', {
    schema: {
      params: { type: 'object', required: ['id', 'mediaType'], properties: { id, mediaType: { type: 'string', enum: ['movie', 'tv'] } } },
      querystring: { type: 'object', properties: { refresh: { type: 'boolean', default: false } } },
    },
  }, async (request, reply) => {
    const { id: tmdbId, mediaType } = request.params as { id: number; mediaType: 'movie' | 'tv' };
    try { return await getServiceMetadata(tmdbId, mediaType, { userId: request.user?.id, refresh: (request.query as { refresh: boolean }).refresh }); }
    catch { return reply.status(502).send({ error: 'Service metadata unavailable' }); }
  });
  app.get('/tv/:id/seasons', {
    schema: { params: { type: 'object', required: ['id'], properties: { id } } },
  }, async (request, reply) => {
    try { return await getSeriesCatalog((request.params as { id: number }).id, false, request.user?.id); }
    catch { return reply.status(502).send({ error: 'Series metadata unavailable' }); }
  });
  app.get('/tv/:id/seasons/:seasonNumber/episodes', {
    schema: {
      params: { type: 'object', required: ['id', 'seasonNumber'], properties: { id, seasonNumber: id } },
      querystring: { type: 'object', required: ['source'], properties: { source: { type: 'string', pattern: '^[a-f0-9]{64}$' } } },
    },
  }, async (request, reply) => {
    const { id: tmdbId, seasonNumber } = request.params as { id: number; seasonNumber: number };
    try { return await getSeriesEpisodes(tmdbId, seasonNumber, (request.query as { source: string }).source, request.user?.id); }
    catch (error) {
      return reply.status(error instanceof SeriesCatalogError ? error.statusCode : 502)
        .send({ error: error instanceof SeriesCatalogError ? error.message : 'Series episodes unavailable' });
    }
  });
}
