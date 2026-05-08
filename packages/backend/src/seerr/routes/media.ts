import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { buildSeerrMedia } from '../adapters/media.js';
import { mapMediaStatus } from '../adapters/statusMap.js';

const DEFAULT_TAKE = 10;
const MAX_TAKE = 100;

/**
 * Overseerr `/media` (list) and `/media/:id` (detail). Maintainerr in particular pages through
 * this list during library scans, so we honour `take`/`skip` and the `filter` query param —
 * other Overseerr query params (`sort`, `requestedBy`) get a best-effort handling.
 */
export async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { take?: string; skip?: string; filter?: string; sort?: string } }>(
    '/media',
    async (request) => {
      const take = clampInt(request.query.take, DEFAULT_TAKE, 1, MAX_TAKE);
      const skip = clampInt(request.query.skip, 0, 0, Number.MAX_SAFE_INTEGER);
      const sort = request.query.sort === 'modified' ? 'updatedAt' : 'createdAt';
      const where: Record<string, unknown> = {};

      const filterStatus = mapFilterToOscarrStatus(request.query.filter);
      if (filterStatus) where.status = filterStatus;

      const [results, totalResults] = await Promise.all([
        prisma.media.findMany({ where, orderBy: { [sort]: 'desc' }, take, skip }),
        prisma.media.count({ where }),
      ]);

      return {
        pageInfo: {
          pages: Math.max(1, Math.ceil(totalResults / take)),
          pageSize: take,
          results: totalResults,
          page: Math.floor(skip / take) + 1,
        },
        results: results.map(buildSeerrMedia),
      };
    },
  );

  app.get<{ Params: { id: string } }>('/media/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });

    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return reply.status(404).send({ error: 'NOT_FOUND' });
    return buildSeerrMedia(media);
  });

  // Used by `/media/:id` callers that already know the Overseerr media.id and want the request
  // history attached. We fold it into the same handler (return a `requests` array) when needed.
  app.get<{ Params: { id: string } }>('/media/:id/watch_data', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });
    // Oscarr doesn't track per-user playback metrics; report empty so dashboards collapse the widget.
    return { data: { users: [], playCount: 0, playCount7Days: 0, playCount30Days: 0 } };
  });

  // Tip clients that ask for status counts grouped by Overseerr's MediaStatus enum.
  app.get('/media/count', async () => {
    const groups = await prisma.media.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = new Map<string, number>();
    for (const g of groups) byStatus.set(g.status, g._count._all);
    return {
      total: [...byStatus.values()].reduce((a, b) => a + b, 0),
      pending:    byStatus.get('pending') ?? 0,
      processing: byStatus.get('processing') ?? 0,
      available:  byStatus.get('available') ?? 0,
      deleted:    byStatus.get('deleted') ?? 0,
    };
  });

  // Suppress unused-import warning while we still want the helper available for richer filtering
  // (e.g. status >= AVAILABLE) once we extend the filter map.
  void mapMediaStatus;
}

function mapFilterToOscarrStatus(filter: string | undefined): string | null {
  switch (filter) {
    case 'available':           return 'available';
    case 'processing':          return 'processing';
    case 'pending':             return 'pending';
    case 'deleted':             return 'deleted';
    default:                    return null;
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
