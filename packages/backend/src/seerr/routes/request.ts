import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { buildSeerrRequest } from '../adapters/request.js';
import { filterToWhere } from '../adapters/statusMap.js';

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
          include: {
            media: true,
            user: { include: { providers: true } },
            approvedBy: { include: { providers: true } },
          },
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
        pageInfo: {
          pages: Math.max(1, Math.ceil(totalResults / take)),
          pageSize: take,
          results: totalResults,
          page: Math.floor(skip / take) + 1,
        },
        results: results.map((r) => buildSeerrRequest({ request: r, requestCountByUserId })),
      };
    },
  );

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
      include: {
        media: true,
        user: { include: { providers: true } },
        approvedBy: { include: { providers: true } },
      },
    });
    if (!found) return reply.status(404).send({ error: 'NOT_FOUND' });

    const userIds = [found.userId];
    if (found.approvedById) userIds.push(found.approvedById);
    const requestCountByUserId = await countRequestsPerUser(userIds);

    return buildSeerrRequest({ request: found, requestCountByUserId });
  });
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseIntOrNull(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function countRequestsPerUser(userIds: number[]): Promise<Map<number, number>> {
  if (userIds.length === 0) return new Map();
  const groups = await prisma.mediaRequest.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.userId, g._count._all]));
}
