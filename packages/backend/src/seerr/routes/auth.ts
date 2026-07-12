import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { buildSeerrUser } from '../adapters/user.js';

export async function authRoutes(app: FastifyInstance) {
  app.get('/auth/me', async (request, reply) => {
    const authed = request.user;
    const user = await prisma.user.findUnique({
      where: { id: authed.id },
      include: { providers: true },
    });
    if (!user) return reply.status(401).send({ error: 'UNAUTHORIZED' });

    const requestCount = await prisma.mediaRequest.count({ where: { userId: user.id } });
    return buildSeerrUser({ user, requestCount });
  });
}
