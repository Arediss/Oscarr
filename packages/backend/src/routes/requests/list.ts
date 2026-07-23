import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { parseId, parsePage } from '../../utils/params.js';
import { REQUEST_STATUSES, COMPLETABLE_REQUEST_STATUSES } from '@oscarr/shared';
import { promoteStaleStatuses, resolveServiceContext } from '../../services/requestService.js';
import { getServiceTypeForMedia } from '../../providers/index.js';

const VALID_STATUSES = new Set<string>(REQUEST_STATUSES);

/** Read-only request routes — paginated list with filters, aggregate stats, and an admin
 *  "resolve service context" preview that shows which service + root folder + quality a
 *  request would land in once approved (lets admins spot routing rule mismatches before
 *  committing). */
export async function requestListRoutes(app: FastifyInstance) {
  app.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by request status (pending, approved, declined, processing, available, failed)' },
          page: { type: 'string', description: 'Page number for pagination' },
          userId: { type: 'string', description: 'Filter by user ID (admin only)' },
          mediaType: { type: 'string', enum: ['movie', 'tv'], description: 'Filter by media type' },
          qualityOptionId: { type: 'string', description: 'Filter by quality option ID' },
        },
      },
    },
  }, async (request) => {
    const user = request.user;
    const { status, page, userId, mediaType, qualityOptionId } = request.query as {
      status?: string; page?: string; userId?: string; mediaType?: string; qualityOptionId?: string;
    };
    const pageNum = parsePage(page);
    const take = 20;
    const skip = (pageNum - 1) * take;

    const where: Record<string, unknown> = {};
    if (request.ownerScoped) {
      where.userId = user.id;
    } else if (userId) {
      const uid = parseId(userId);
      if (uid) where.userId = uid;
    }
    if (status && VALID_STATUSES.has(status)) where.status = status;
    if (mediaType && ['movie', 'tv'].includes(mediaType)) where.mediaType = mediaType;
    if (qualityOptionId) {
      const qid = parseId(qualityOptionId);
      if (qid) where.qualityOptionId = qid;
    }

    await promoteStaleStatuses();

    const [requests, total] = await Promise.all([
      prisma.mediaRequest.findMany({
        where,
        include: {
          media: {
            select: {
              id: true,
              tmdbId: true,
              mediaType: true,
              title: true,
              posterPath: true,
              backdropPath: true,
              releaseDate: true,
              statusCategory: true,
              availableAt: true,
            },
          },
          user: { select: { id: true, displayName: true, avatar: true } },
          approvedBy: { select: { id: true, displayName: true } },
          qualityOption: { select: { id: true, label: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.mediaRequest.count({ where }),
    ]);

    return {
      results: requests,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / take),
    };
  });

  app.get('/stats', async (request) => {
    const user = request.user;
    const userFilter = request.ownerScoped ? { userId: user.id } : {};

    // `processing` was counting Media.status values ('searching'/'upcoming') which are
    // never written to MediaRequest.status, so it always returned 0. Use COMPLETABLE
    // (approved + processing + failed) — the real "in flight from dispatch to completion".
    const [total, pending, approved, available, declined, failed, processing] = await Promise.all([
      prisma.mediaRequest.count({ where: userFilter }),
      prisma.mediaRequest.count({ where: { ...userFilter, status: 'pending' } }),
      prisma.mediaRequest.count({ where: { ...userFilter, status: 'approved' } }),
      prisma.mediaRequest.count({ where: { ...userFilter, status: 'available' } }),
      prisma.mediaRequest.count({ where: { ...userFilter, status: 'declined' } }),
      prisma.mediaRequest.count({ where: { ...userFilter, status: 'failed' } }),
      prisma.mediaRequest.count({ where: { ...userFilter, status: { in: [...COMPLETABLE_REQUEST_STATUSES] } } }),
    ]);

    return { total, pending, approved, available, declined, failed, processing };
  });

  app.get('/:id/resolve', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      querystring: { type: 'object', properties: { qualityOptionId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const requestId = parseId((request.params as { id: string }).id);
    if (!requestId) return reply.status(400).send({ error: 'INVALID_ID' });
    const overrideQuality = parseId((request.query as { qualityOptionId?: string }).qualityOptionId || '');

    const mediaRequest = await prisma.mediaRequest.findUnique({
      where: { id: requestId },
      include: { media: true, qualityOption: { select: { id: true, label: true } } },
    });
    if (!mediaRequest) return reply.status(404).send({ error: 'REQUEST_NOT_FOUND' });

    const effectiveQuality = overrideQuality ?? mediaRequest.qualityOptionId ?? undefined;
    let ctx;
    try {
      ctx = await resolveServiceContext(
        mediaRequest.mediaType as 'movie' | 'tv',
        mediaRequest.media.tmdbId,
        mediaRequest.userId,
        effectiveQuality,
      );
    } catch {
      return reply.status(502).send({ error: 'SERVICE_CONTEXT_UNREACHABLE' });
    }

    const matchedRuleName = ctx.ruleMatch?.ruleName ?? null;

    const serviceType = getServiceTypeForMedia(mediaRequest.mediaType);
    let availableRootFolders: { path: string }[] = [];
    try {
      const { getArrClient, getArrClientForService } = await import('../../providers/index.js');
      const client = ctx.targetService
        ? getArrClientForService(ctx.targetService.id, serviceType, ctx.targetService.config)
        : await getArrClient(serviceType);
      const folders = await client.getRootFolders();
      availableRootFolders = folders.map((f) => ({ path: f.path }));
    } catch { /* service unreachable — return empty list, the UI treats it as no routing options */ }

    const { getAllServices } = await import('../../utils/services.js');
    const availableServices = (await getAllServices(serviceType)).map((s) => ({ id: s.id, name: s.name }));

    return {
      qualityOption: effectiveQuality
        ? await prisma.qualityOption.findUnique({ where: { id: effectiveQuality }, select: { id: true, label: true } })
        : mediaRequest.qualityOption,
      folderPath: ctx.ruleMatch?.folderPath || ctx.defaultFolder || null,
      matchedRule: matchedRuleName,
      serviceName: ctx.targetService
        ? (await prisma.service.findUnique({ where: { id: ctx.targetService.id }, select: { name: true } }))?.name
        : null,
      seriesType: ctx.ruleMatch?.seriesType || null,
      targetServiceId: ctx.targetService?.id || null,
      availableRootFolders,
      availableServices,
    };
  });
}
