import type { FastifyInstance } from 'fastify';
import { getAppSettings } from '../../utils/appSettings.js';
import { triggerJob } from '../../services/scheduler.js';

export async function syncRoutes(app: FastifyInstance) {
  // Keep legacy sync endpoints for backwards compat
  app.get('/sync/status', async (request, reply) => {

    const settings = await getAppSettings();
    // syncIntervalHours is no longer read by anything — cron schedules own the cadence, per job,
    // in the CronJob table. Reporting it here advertised a setting that changed nothing.
    return {
      lastRadarrSync: settings?.lastRadarrSync,
      lastSonarrSync: settings?.lastSonarrSync,
    };
  });

  app.post('/sync/run', async (request, reply) => {

    return triggerJob('full_sync');
  });

  app.post('/sync/force', { config: { rateLimit: { max: 1, timeWindow: '5 minutes' } } }, async (request, reply) => {

    // full_sync already ignores incremental cutoffs; share its lock with upgrade/cron runs.
    const outcome = await triggerJob('full_sync');
    if (outcome.skipped) return reply.code(409).send(outcome);
    return outcome.result;
  });
}
