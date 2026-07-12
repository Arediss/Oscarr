import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { buildSeerrRequest } from '../adapters/request.js';
import { filterToWhere } from '../adapters/statusMap.js';
import { createUserRequest } from '../../services/requestService.js';
import { clampInt, buildSeerrPageInfo, countRequestsPerUser, SEERR_REQUEST_INCLUDE } from '../shared.js';

const DEFAULT_TAKE = 10;
const MAX_TAKE = 100;

export async function requestRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { take?: string; skip?: string; filter?: string; sort?: string; requestedBy?: string } }>(
    '/request',
    async (request) => {
      const take = clampInt(request.query.take, DEFAULT_TAKE, 1, MAX_TAKE);
      const skip = clampInt(request.query.skip, 0, 0, Number.MAX_SAFE_INTEGER);
      const sort = request.query.sort === 'modified' ? 'updatedAt' : 'createdAt';
      const where: Record<string, unknown> = {};
      const statusFilter = filterToWhere(request.query.filter);
      if (statusFilter) Object.assign(where, statusFilter);

      const requestedById = parseIntOrNull(request.query.requestedBy);
      if (requestedById !== null) where.userId = requestedById;

      const [results, totalResults] = await Promise.all([
        prisma.mediaRequest.findMany({
          where,
          orderBy: { [sort]: 'desc' },
          take,
          skip,
          include: SEERR_REQUEST_INCLUDE,
        }),
        prisma.mediaRequest.count({ where }),
      ]);

      const userIds = new Set<number>();
      for (const r of results) {
        userIds.add(r.userId);
        if (r.approvedById) userIds.add(r.approvedById);
      }
      const requestCountByUserId = await countRequestsPerUser([...userIds]);

      return {
        pageInfo: buildSeerrPageInfo(take, skip, totalResults),
        results: results.map((r) => buildSeerrRequest({ request: r, requestCountByUserId })),
      };
    },
  );

  app.post<{
    Body: {
      mediaType?: string;
      mediaId?: number | string;
      tvdbId?: number;
      seasons?: number[] | 'all';
      is4k?: boolean;
      serverId?: number;
      profileId?: number;
      rootFolder?: string;
      languageProfileId?: number;
      userId?: number;
    };
  }>('/request', async (request, reply) => {
    const body = request.body ?? {};
    const mediaType = body.mediaType;
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'mediaType must be "movie" or "tv"' });
    }

    // Overseerr's `mediaId` is the TMDB id (not their internal Media.id) — that's what every
    // upstream client passes through. Reject anything that doesn't parse to a positive int so
    // a stray internal id doesn't silently create the wrong request.
    const tmdbId = Number(body.mediaId);
    if (!Number.isInteger(tmdbId) || tmdbId < 1) {
      return reply.status(400).send({ error: 'INVALID_INPUT', message: 'mediaId must be a positive TMDB id' });
    }

    // Overseerr accepts either an array of season numbers or the string "all" (which we resolve
    // by passing `undefined` so requestService.create()'s "all seasons" default kicks in).
    let seasons: number[] | undefined;
    if (Array.isArray(body.seasons)) {
      seasons = body.seasons.filter((n) => Number.isInteger(n) && n >= 0);
    } else if (body.seasons === 'all') {
      seasons = undefined;
    }

    const actor = request.user;

    // Overseerr-compat: clients (Doplarr) can pass `X-API-User: <id>` to attribute the
    // request to a specific user, e.g. mapping a Discord user to an Oscarr account. We honour
    // this only when the caller has admin scope — otherwise a non-admin could impersonate
    // any user by spoofing the header.
    const xApiUser = request.headers['x-api-user'];
    const xApiUserId = Number(Array.isArray(xApiUser) ? xApiUser[0] : xApiUser);
    let onBehalfOfUserId = actor.id;
    if (Number.isInteger(xApiUserId) && xApiUserId > 0 && xApiUserId !== actor.id) {
      if (actor.role !== 'admin') {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'X-API-User requires an admin-scoped API key',
        });
      }
      const exists = await prisma.user.findUnique({ where: { id: xApiUserId }, select: { id: true } });
      if (!exists) {
        return reply.status(400).send({ error: 'INVALID_INPUT', message: `User ${xApiUserId} not found` });
      }
      onBehalfOfUserId = xApiUserId;
    }

    const result = await createUserRequest({
      userId: onBehalfOfUserId,
      tmdbId,
      mediaType,
      seasons,
      rootFolder: body.rootFolder,
      qualityOptionId: body.profileId,
    });

    if (!result.ok) {
      const httpStatus = result.status;
      return reply.status(httpStatus).send({
        error: result.code,
        message: result.error,
      });
    }

    const created = await prisma.mediaRequest.findUnique({
      where: { id: result.request.id },
      include: SEERR_REQUEST_INCLUDE,
    });
    if (!created) return reply.status(500).send({ error: 'INTERNAL', message: 'Created request not found on read-back' });

    const requestCountByUserId = await countRequestsPerUser([created.userId]);
    return reply.status(201).send(buildSeerrRequest({ request: created, requestCountByUserId }));
  });

  app.get('/request/count', async () => {
    const groups = await prisma.mediaRequest.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = new Map<string, number>();
    for (const g of groups) byStatus.set(g.status, g._count._all);

    const movie = await prisma.mediaRequest.count({ where: { mediaType: 'movie' } });
    const tv = await prisma.mediaRequest.count({ where: { mediaType: 'tv' } });

    return {
      total: movie + tv,
      movie,
      tv,
      pending:    byStatus.get('pending') ?? 0,
      approved:   (byStatus.get('approved') ?? 0) + (byStatus.get('processing') ?? 0) + (byStatus.get('available') ?? 0),
      declined:   byStatus.get('declined') ?? 0,
      processing: byStatus.get('processing') ?? 0,
      available:  byStatus.get('available') ?? 0,
    };
  });

  app.get<{ Params: { id: string } }>('/request/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });

    const found = await prisma.mediaRequest.findUnique({
      where: { id },
      include: SEERR_REQUEST_INCLUDE,
    });
    if (!found) return reply.status(404).send({ error: 'NOT_FOUND' });

    const userIds = [found.userId];
    if (found.approvedById) userIds.push(found.approvedById);
    const requestCountByUserId = await countRequestsPerUser(userIds);

    return buildSeerrRequest({ request: found, requestCountByUserId });
  });
}

function parseIntOrNull(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
