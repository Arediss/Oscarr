import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { parseId } from '../utils/params.js';

const PAGE_SIZE = 20;

export async function notificationRoutes(app: FastifyInstance) {
  // GET / — paginated list (newest first)
  app.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page number (1-based)' },
          unreadOnly: { type: 'string', enum: ['true', 'false'], description: 'Filter unread only' },
        },
      },
    },

  }, async (request, reply) => {
    const user = request.user;
    const { page, unreadOnly } = request.query as { page?: string; unreadOnly?: string };
    const pageNum = Math.max(1, Number.parseInt(page || '1', 10) || 1);

    const where = {
      userId: user.id,
      ...(unreadOnly === 'true' ? { read: false } : {}),
    };

    const [notifications, total] = await Promise.all([
      prisma.userNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.userNotification.count({ where }),
    ]);

    return reply.send({
      notifications: notifications.map((n) => ({
        ...n,
        metadata: n.metadata ? JSON.parse(n.metadata) : null,
      })),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / PAGE_SIZE),
    });
  });

  // GET /unread-count
  app.get('/unread-count', {

  }, async (request, reply) => {
    const user = request.user;
    const count = await prisma.userNotification.count({
      where: { userId: user.id, read: false },
    });
    return reply.send({ count });
  });

  // PUT /:id/read — mark one as read
  app.put('/:id/read', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },

  }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params as { id: string };
    const notifId = parseId(id);
    if (!notifId) return reply.status(400).send({ error: 'INVALID_ID' });

    const notif = await prisma.userNotification.findFirst({
      where: { id: notifId, userId: user.id },
    });
    if (!notif) return reply.status(404).send({ error: 'NOTIFICATION_NOT_FOUND' });

    await prisma.userNotification.update({
      where: { id: notifId },
      data: { read: true },
    });

    return reply.send({ success: true });
  });

  // PUT /read-all — mark all as read
  app.put('/read-all', {

  }, async (request, reply) => {
    const user = request.user;
    await prisma.userNotification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return reply.send({ success: true });
  });

  // DELETE /:id — delete a notification
  app.delete('/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },

  }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params as { id: string };
    const notifId = parseId(id);
    if (!notifId) return reply.status(400).send({ error: 'INVALID_ID' });

    const notif = await prisma.userNotification.findFirst({
      where: { id: notifId, userId: user.id },
    });
    if (!notif) return reply.status(404).send({ error: 'NOTIFICATION_NOT_FOUND' });

    await prisma.userNotification.delete({ where: { id: notifId } });

    return reply.send({ success: true });
  });
}
