import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { buildSeerrUser } from '../adapters/user.js';
import { clampInt, buildSeerrPageInfo, countRequestsPerUser, SEERR_REQUEST_INCLUDE } from '../shared.js';

const DEFAULT_TAKE = 10;
const MAX_TAKE = 200;

/**
 * /user — list, /user/:id — detail, /user/:id/quota — quota check.
 *
 * Doplarr in particular calls /user during its request flow to map the Discord caller to an
 * Overseerr user (so it can attribute the request to the right person). Mobile clients use
 * /user/:id/quota to decide whether to grey out the request button before submitting.
 *
 * Quota responses report unlimited — Oscarr's quota enforcement lives in the optional
 * `plugin-quotas` plugin, which will own its own /quota response shape once it's wired in.
 */
export async function userRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { take?: string; skip?: string; q?: string; sort?: string } }>(
    '/user',
    async (request) => {
      const take = clampInt(request.query.take, DEFAULT_TAKE, 1, MAX_TAKE);
      const skip = clampInt(request.query.skip, 0, 0, Number.MAX_SAFE_INTEGER);
      const q = (request.query.q ?? '').trim();
      const where = q
        ? {
            OR: [
              { email: { contains: q } },
              { displayName: { contains: q } },
            ],
          }
        : undefined;
      const orderBy = orderByForSort(request.query.sort);

      const [results, totalResults] = await Promise.all([
        prisma.user.findMany({ where, orderBy, take, skip, include: { providers: true } }),
        prisma.user.count({ where }),
      ]);

      const requestCountByUserId = await countRequestsPerUser(results.map((u) => u.id));

      return {
        pageInfo: buildSeerrPageInfo(take, skip, totalResults),
        results: results.map((user) => buildSeerrUser({
          user,
          requestCount: requestCountByUserId.get(user.id) ?? 0,
        })),
      };
    },
  );

  app.get<{ Params: { id: string } }>('/user/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });
    const user = await prisma.user.findUnique({ where: { id }, include: { providers: true } });
    if (!user) return reply.status(404).send({ error: 'NOT_FOUND' });
    const requestCount = await prisma.mediaRequest.count({ where: { userId: id } });
    return buildSeerrUser({ user, requestCount });
  });

  app.get<{ Params: { id: string } }>('/user/:id/quota', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.status(404).send({ error: 'NOT_FOUND' });
    return {
      movie: { days: null, limit: null, used: 0, remaining: null, restricted: false },
      tv:    { days: null, limit: null, used: 0, remaining: null, restricted: false },
    };
  });

  app.get<{ Params: { id: string }; Querystring: { take?: string; skip?: string } }>(
    '/user/:id/requests',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });
      const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!exists) return reply.status(404).send({ error: 'NOT_FOUND' });

      const take = clampInt(request.query.take, DEFAULT_TAKE, 1, MAX_TAKE);
      const skip = clampInt(request.query.skip, 0, 0, Number.MAX_SAFE_INTEGER);
      const totalResults = await prisma.mediaRequest.count({ where: { userId: id } });
      const results = await prisma.mediaRequest.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: SEERR_REQUEST_INCLUDE,
      });
      const requestCountByUserId = await countRequestsPerUser(
        [...new Set(results.flatMap((r) => r.approvedById ? [r.userId, r.approvedById] : [r.userId]))],
      );
      const { buildSeerrRequest } = await import('../adapters/request.js');
      return {
        pageInfo: buildSeerrPageInfo(take, skip, totalResults),
        results: results.map((r) => buildSeerrRequest({ request: r, requestCountByUserId })),
      };
    },
  );
}

function orderByForSort(sort: string | undefined): Record<string, 'asc' | 'desc'> {
  switch (sort) {
    case 'updated': return { updatedAt: 'desc' };
    case 'requests': return { id: 'desc' }; // Oscarr can't sort by requestCount cheaply; fall back to id
    case 'displayname': return { displayName: 'asc' };
    default: return { id: 'asc' };
  }
}
