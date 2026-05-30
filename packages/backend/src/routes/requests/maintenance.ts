import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { getArrClient, getServiceTypeForMedia, arrIdForMedia } from '../../providers/index.js';
import { logEvent } from '../../utils/logEvent.js';
import { pluginEngine } from '../../plugins/engine.js';

async function runPluginGuard(userId: number) {
  return pluginEngine.runGuards('request.create', userId);
}

/** Bulk maintenance routes — missing-episode search re-trigger (with cooldown) and the admin
 *  cleanup-by-status broom (keep / remove-oscarr-only / remove-from-service-too per bucket).
 *  Lives separately from per-request lifecycle because these touch many rows at once. */
export async function requestMaintenanceRoutes(app: FastifyInstance) {
  app.post('/search-missing', {
    schema: {
      body: {
        type: 'object' as const,
        required: ['tmdbId', 'mediaType'],
        properties: {
          tmdbId: { type: 'number' },
          mediaType: { type: 'string', enum: ['movie', 'tv'] },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user as { id: number; role: string };
    const { tmdbId, mediaType } = request.body as { tmdbId: number; mediaType: string };

    if (user.role !== 'admin') {
      const guardResult = await runPluginGuard(user.id);
      if (guardResult?.blocked) return reply.status(guardResult.statusCode || 403).send({ error: guardResult.error });
    }

    const media = await prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
    if (!media) return reply.status(404).send({ error: 'Media not found' });

    // Cooldown — missing-episode search is expensive on the *arr side; throttle repeats so
    // impatient users can't hammer it.
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const cooldownMin = settings?.missingSearchCooldownMin ?? 60;
    if (media.lastMissingSearchAt) {
      const elapsed = Date.now() - new Date(media.lastMissingSearchAt).getTime();
      const remaining = Math.ceil((cooldownMin * 60 * 1000 - elapsed) / 60000);
      if (elapsed < cooldownMin * 60 * 1000) {
        return reply.status(429).send({ error: `Search already started recently. Try again in ${remaining} min.`, cooldownRemaining: remaining });
      }
    }

    try {
      const serviceId = arrIdForMedia(media);
      if (!serviceId) {
        return reply.status(400).send({ error: 'This media is not yet in the service' });
      }
      const serviceType = getServiceTypeForMedia(mediaType);
      const client = await getArrClient(serviceType);
      await client.searchMedia(serviceId);

      await prisma.media.update({ where: { id: media.id }, data: { lastMissingSearchAt: new Date() } });
      logEvent('info', 'Request', `Missing episodes search started for "${media.title}"`);
      return reply.send({ ok: true });
    } catch (err) {
      logEvent('debug', 'Request', `Search missing failed: ${err}`);
      return reply.status(502).send({ error: 'Failed to start search' });
    }
  });

  // Actions per status: 'keep' | 'remove' (Oscarr only) | 'remove_with_service' (also purges
  // the media from Radarr/Sonarr).
  app.post('/cleanup', {
    schema: {
      body: {
        type: 'object',
        required: ['actions'],
        properties: {
          actions: {
            type: 'object',
            additionalProperties: { type: 'string', enum: ['keep', 'remove', 'remove_with_service'] },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { actions } = request.body as { actions: Record<string, 'keep' | 'remove' | 'remove_with_service'> };
    const validStatuses = new Set(['pending', 'available', 'approved', 'declined', 'failed']);
    let deletedFromOscarr = 0;
    let deletedFromService = 0;

    for (const [status, action] of Object.entries(actions)) {
      if (!validStatuses.has(status) || action === 'keep') continue;

      if (action === 'remove_with_service') {
        const requests = await prisma.mediaRequest.findMany({
          where: { status },
          include: { media: { select: { radarrId: true, sonarrId: true, mediaType: true } } },
        });

        for (const req of requests) {
          try {
            const serviceType = getServiceTypeForMedia(req.media.mediaType);
            const serviceId = arrIdForMedia(req.media);
            if (serviceId) {
              const client = await getArrClient(serviceType);
              await client.deleteMedia(serviceId, true);
              deletedFromService++;
            }
          } catch (err) {
            logEvent('debug', 'Cleanup', `Failed to delete from service for request ${req.id}: ${err}`);
          }
        }
      }

      const result = await prisma.mediaRequest.deleteMany({ where: { status } });
      deletedFromOscarr += result.count;
    }

    logEvent('info', 'Request', `Cleanup: ${deletedFromOscarr} requests deleted, ${deletedFromService} removed from services`);
    return reply.send({ deletedFromOscarr, deletedFromService });
  });
}
