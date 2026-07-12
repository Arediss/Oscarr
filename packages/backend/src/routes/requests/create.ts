import type { FastifyInstance } from 'fastify';
import { getCollection } from '../../services/tmdb.js';
import {
  createUserRequest,
  requestCollectionMovie,
} from '../../services/requestService.js';
import { pluginEngine } from '../../plugins/engine.js';

/** Create-request paths — the hot path for a user asking for a movie/tv (one) and the bulk
 *  collection endpoint that fan-outs one request per movie in a TMDB collection. The heavy
 *  lifting (validation → guard → blacklist → dedup → autoApprove → send → notify) lives in
 *  `createUserRequest` so plugins via `ctx.requests.create` hit the exact same pipeline. */
export async function requestCreateRoutes(app: FastifyInstance) {
  app.post('/', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['tmdbId', 'mediaType'],
        properties: {
          tmdbId: { type: 'number', description: 'TMDB ID of the media to request' },
          mediaType: { type: 'string', enum: ['movie', 'tv'], description: 'Type of media' },
          seasons: { type: 'array', items: { type: 'number' }, description: 'Season numbers to request (TV only)' },
          rootFolder: { type: 'string', description: 'Root folder path override' },
          qualityOptionId: { type: 'number', description: 'Quality option ID for quality profile mapping' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user;
    const body = request.body as { tmdbId: unknown; mediaType: unknown; seasons?: unknown; rootFolder?: string; qualityOptionId?: number };

    const result = await createUserRequest({
      userId: user.id,
      tmdbId: body.tmdbId,
      mediaType: body.mediaType,
      seasons: body.seasons,
      rootFolder: body.rootFolder,
      qualityOptionId: body.qualityOptionId,
    });

    if (!result.ok) return reply.status(result.status).send({ error: result.error });
    if (result.sendFailed) return reply.status(202).send({ ...result.request, status: 'failed', sendError: true });
    return reply.status(201).send(result.request);
  });

  app.post('/collection', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['collectionId'],
        properties: { collectionId: { type: 'number' } },
      },
    },
  }, async (request, reply) => {
    const user = request.user;
    const { collectionId } = request.body as { collectionId: unknown };

    if (typeof collectionId !== 'number' || !Number.isFinite(collectionId) || collectionId < 1) {
      return reply.status(400).send({ error: 'Invalid collectionId' });
    }

    if (user.role !== 'admin') {
      const guardResult = await pluginEngine.runGuards('request.create', user.id);
      if (guardResult?.blocked) return reply.status(guardResult.statusCode || 403).send({ error: guardResult.error });
    }

    const collection = await getCollection(collectionId);
    if (!collection?.parts?.length) return reply.status(404).send({ error: 'Collection not found' });

    let requested = 0;
    let skipped = 0;
    for (const movie of collection.parts) {
      const wasRequested = await requestCollectionMovie(movie.id, user);
      if (wasRequested) requested++;
      else skipped++;
    }

    return reply.status(201).send({
      collection: collection.name,
      total: collection.parts.length,
      requested,
      skipped,
    });
  });
}
