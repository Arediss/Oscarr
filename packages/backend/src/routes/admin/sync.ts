import type { FastifyInstance } from 'fastify';
import { getAppSettings, patchAppSettings } from '../../utils/appSettings.js';
import { syncArrService } from '../../services/sync/mediaSync.js';
import { syncAvailabilityDates } from '../../services/sync/availabilitySync.js';
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

    await patchAppSettings({ lastRadarrSync: null, lastSonarrSync: null });
    const radarrResult = await syncArrService('radarr', null);
    const sonarrResult = await syncArrService('sonarr', null);
    await syncAvailabilityDates(null);
    return { radarr: radarrResult, sonarr: sonarrResult };
  });
}
