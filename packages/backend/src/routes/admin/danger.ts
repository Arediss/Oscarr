import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { logEvent } from '../../utils/logEvent.js';
import { parseId } from '../../utils/params.js';

export async function dangerRoutes(app: FastifyInstance) {
  // === DANGER ZONE ===

  // Purge all requests
  app.delete('/danger/requests', async (request, reply) => {

    const { count } = await prisma.mediaRequest.deleteMany();
    logEvent('warn', 'Admin', `Purge: ${count} requests deleted`);
    return { ok: true, deleted: count };
  });

  // Purge all media (to re-import fresh)
  app.delete('/danger/media', async (request, reply) => {

    // Requests reference media, delete them first
    const { count: reqCount } = await prisma.mediaRequest.deleteMany();
    const { count: seasonCount } = await prisma.season.deleteMany();
    const { count: mediaCount } = await prisma.media.deleteMany();
    logEvent('warn', 'Admin', `Purge: ${mediaCount} media, ${seasonCount} seasons, ${reqCount} requests deleted`);
    return { ok: true, deleted: { media: mediaCount, seasons: seasonCount, requests: reqCount } };
  });

  // Delete a specific user (and cascade their requests/tickets)
  app.delete('/danger/users/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'User ID to delete' },
        },
      },
    },
  }, async (request, reply) => {

    const { id } = request.params as { id: string };
    const userId = parseId(id);
    if (!userId) return reply.status(400).send({ error: 'Invalid ID' });

    const currentUser = request.user;
    if (userId === currentUser.id) return reply.status(400).send({ error: 'Cannot delete your own account' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    await prisma.user.delete({ where: { id: userId } });
    logEvent('warn', 'Admin', `User deleted: ${user.displayName || user.email}`);
    return { ok: true };
  });

  // Purge all users except current admin
  app.delete('/danger/users', async (request, reply) => {

    const currentUser = request.user;
    const { count } = await prisma.user.deleteMany({ where: { id: { not: currentUser.id } } });
    logEvent('warn', 'Admin', `Purge: ${count} users deleted`);
    return { ok: true, deleted: count };
  });
}
