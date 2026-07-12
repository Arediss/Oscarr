import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { logEvent } from '../../utils/logEvent.js';
import { safeNotify, safeUserNotify, buildSiteLink } from '../../utils/safeNotify.js';
import { parseId } from '../../utils/params.js';
import { sendToService } from '../../services/requestService.js';
import { transitionRequestStatus } from '../../services/requestStatusTransition.js';
import type { RequestStatusKind } from '@oscarr/shared';

/** Per-request state transitions — approve, decline, edit routing, delete. Owner-scoping on
 *  delete prevents a non-admin from deleting someone else's request. */
export async function requestLifecycleRoutes(app: FastifyInstance) {
  app.post('/:id/approve', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', properties: { qualityOptionId: { type: 'number' } } },
    },
  }, async (request, reply) => {
    const user = request.user;
    const requestId = parseId((request.params as { id: string }).id);
    if (!requestId) return reply.status(400).send({ error: 'Invalid ID' });
    const { qualityOptionId: overrideQuality } = (request.body as { qualityOptionId?: number }) || {};

    const mediaRequest = await prisma.mediaRequest.findUnique({
      where: { id: requestId },
      include: { media: true, user: { select: { displayName: true, email: true, id: true } } },
    });
    if (!mediaRequest) return reply.status(404).send({ error: 'Request not found' });
    if (mediaRequest.status !== 'pending') return reply.status(400).send({ error: 'This request cannot be approved' });

    const effectiveQuality = overrideQuality ?? mediaRequest.qualityOptionId ?? undefined;
    if (overrideQuality && overrideQuality !== mediaRequest.qualityOptionId) {
      await prisma.mediaRequest.update({ where: { id: requestId }, data: { qualityOptionId: overrideQuality } });
    }

    const seasons = mediaRequest.seasons ? JSON.parse(mediaRequest.seasons) : undefined;
    const tagName = mediaRequest.user.displayName || mediaRequest.user.email || `user-${mediaRequest.user.id}`;
    const sent = await sendToService(mediaRequest.media, mediaRequest.mediaType, tagName, mediaRequest.userId, seasons, effectiveQuality, mediaRequest.rootFolder);

    // Flip to 'searching' so the UI reflects the service-side pickup; preserve 'available' and
    // 'processing' (TV partial) so the "request rest" CTA stays visible.
    if (sent && mediaRequest.media.statusCategory !== 'AVAILABLE' && mediaRequest.media.statusCategory !== 'PROCESSING') {
      await prisma.media.update({
        where: { id: mediaRequest.media.id },
        data: { statusCategory: 'SEARCHING' },
      }).catch((err) => {
        request.log.warn({ err, mediaId: mediaRequest.media.id, requestId }, 'status flip to searching failed');
      });
    }

    const nextStatus: RequestStatusKind = sent ? 'approved' : 'failed';
    const updated = await transitionRequestStatus(
      { requestId, from: mediaRequest.status as RequestStatusKind, to: nextStatus, why: sent ? 'admin-approve' : 'dispatch-failed' },
      () => prisma.mediaRequest.update({
        where: { id: requestId },
        data: { status: nextStatus, approvedById: user.id },
        include: { media: true, user: { select: { id: true, displayName: true, avatar: true } }, qualityOption: { select: { id: true, label: true } } },
      }),
      request.log,
    );

    if (sent) {
      const approvedUrl = await buildSiteLink(`/${updated.mediaType}/${updated.media.tmdbId}`);
      safeNotify('request_approved', { title: updated.media.title, mediaType: updated.mediaType as 'movie' | 'tv', username: updated.user?.displayName || 'User', posterPath: updated.media.posterPath, url: approvedUrl });
      safeUserNotify(updated.user.id, { type: 'request_approved', title: updated.media.title, message: 'notifications.msg.request_approved', metadata: { mediaId: updated.mediaId, tmdbId: updated.media.tmdbId, mediaType: updated.mediaType, msgParams: { title: updated.media.title } } });
      logEvent('info', 'Request', `Request "${updated.media.title}" approved`);
    } else {
      logEvent('error', 'Request', `Request "${updated.media.title}" approved but failed to send to service`);
    }

    return reply.send(updated);
  });

  app.post('/:id/decline', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const user = request.user;
    const requestId = parseId((request.params as { id: string }).id);
    if (!requestId) return reply.status(400).send({ error: 'Invalid ID' });

    const current = await prisma.mediaRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    if (!current) return reply.status(404).send({ error: 'Request not found' });
    if (current.status !== 'pending') return reply.status(400).send({ error: 'This request cannot be declined' });
    const updated = await transitionRequestStatus(
      { requestId, from: current.status as RequestStatusKind, to: 'declined', why: 'admin-decline' },
      () => prisma.mediaRequest.update({
        where: { id: requestId },
        data: { status: 'declined', approvedById: user.id },
        include: { media: true, user: { select: { id: true, displayName: true, avatar: true } } },
      }),
      request.log,
    );

    const declinedUrl = await buildSiteLink(`/${updated.mediaType}/${updated.media.tmdbId}`);
    safeNotify('request_declined', { title: updated.media.title, mediaType: updated.mediaType as 'movie' | 'tv', username: updated.user?.displayName || 'User', posterPath: updated.media.posterPath, url: declinedUrl });
    safeUserNotify(updated.user.id, { type: 'request_declined', title: updated.media.title, message: 'notifications.msg.request_declined', metadata: { mediaId: updated.mediaId, tmdbId: updated.media.tmdbId, mediaType: updated.mediaType, msgParams: { title: updated.media.title } } });
    logEvent('info', 'Request', `Request "${updated.media.title}" declined`);

    return reply.send(updated);
  });

  app.put('/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: { type: 'object', properties: { rootFolder: { type: 'string' }, qualityOptionId: { type: 'number' } } },
    },
  }, async (request, reply) => {
    const requestId = parseId((request.params as { id: string }).id);
    if (!requestId) return reply.status(400).send({ error: 'Invalid ID' });
    const { rootFolder, qualityOptionId } = (request.body as { rootFolder?: string; qualityOptionId?: number }) || {};

    const data: Record<string, unknown> = {};
    if (rootFolder !== undefined) data.rootFolder = rootFolder || null;
    if (qualityOptionId !== undefined) data.qualityOptionId = qualityOptionId || null;

    if (Object.keys(data).length === 0) return reply.status(400).send({ error: 'Nothing to update' });

    const existing = await prisma.mediaRequest.findUnique({ where: { id: requestId } });
    if (!existing) return reply.status(404).send({ error: 'Request not found' });

    const updated = await prisma.mediaRequest.update({
      where: { id: requestId },
      data,
      include: { media: true, qualityOption: { select: { id: true, label: true } } },
    });
    return reply.send(updated);
  });

  app.delete('/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const user = request.user;
    const requestId = parseId((request.params as { id: string }).id);
    if (!requestId) return reply.status(400).send({ error: 'Invalid ID' });

    const mediaRequest = await prisma.mediaRequest.findUnique({ where: { id: requestId } });
    if (!mediaRequest) return reply.status(404).send({ error: 'Request not found' });
    if (request.ownerScoped && mediaRequest.userId !== user.id) return reply.status(403).send({ error: 'Unauthorized' });

    await prisma.mediaRequest.delete({ where: { id: requestId } });
    return reply.send({ ok: true });
  });
}
