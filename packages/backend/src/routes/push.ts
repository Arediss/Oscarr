import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { isPushConfigured } from '../services/pushService.js';

export async function pushRoutes(app: FastifyInstance) {
  // POST /push/subscribe — save subscription for current user
  app.post('/subscribe', async (request, reply) => {
    if (!isPushConfigured()) return reply.status(503).send({ error: 'Push notifications not configured' });

    const user = request.user;
    const { endpoint, keys } = request.body as { endpoint: string; keys: { p256dh: string; auth: string } };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Invalid subscription' });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth }, // Don't overwrite userId — endpoint belongs to whoever registered it first
      create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });

    return { ok: true };
  });

  // DELETE /push/unsubscribe — remove subscription
  app.delete('/unsubscribe', async (request) => {
    const user = request.user;
    const { endpoint } = request.body as { endpoint: string };

    if (endpoint) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    } else {
      // Delete all subscriptions for this user
      await prisma.pushSubscription.deleteMany({ where: { userId: user.id } });
    }

    return { ok: true };
  });
}

// Legacy re-export — new code should import from services/pushService.js directly.
export { sendPushToUsers } from '../services/pushService.js';
