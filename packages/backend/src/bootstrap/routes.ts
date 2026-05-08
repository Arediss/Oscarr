import type { FastifyInstance } from 'fastify';
import { authRoutes } from '../routes/auth.js';
import { tmdbRoutes } from '../routes/tmdb.js';
import { requestRoutes } from '../routes/requests.js';
import { mediaRoutes } from '../routes/media.js';
import { radarrSonarrRoutes } from '../routes/radarr-sonarr.js';
import { adminRoutes } from '../routes/admin/index.js';
import { setupRoutes, setupStatusRoutes } from '../routes/setup.js';
import { isInstalled } from '../utils/install.js';
import { appRoutes } from '../routes/app.js';
import { notificationRoutes } from '../routes/notifications.js';
import { pushRoutes } from '../routes/push.js';
import { seerrRoutes } from '../seerr/index.js';
import { getInstanceLanguages } from '../services/tmdb.js';

/**
 * Mount every HTTP route group under its /api/<prefix>. Warms the TMDB language cache first
 * so the first real request doesn't pay the hydration cost.
 *
 * Webhooks are lazy-imported because they pull in a handful of provider-specific modules we
 * don't need evaluated unless the server actually starts handling requests.
 */
export async function registerRoutes(app: FastifyInstance) {
  // TMDB is a third party — treat cache hydration as a best-effort warm-up, not a gate on
  // boot. A 500 / network blip / bad key should not prevent Oscarr from coming up; the lazy
  // path inside tmdb.ts will retry on first use.
  try {
    await getInstanceLanguages();
  } catch (err) {
    app.log.warn({ err }, 'TMDB language cache warm-up failed — will lazy-load on first request');
  }

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(tmdbRoutes, { prefix: '/api/tmdb' });
  await app.register(requestRoutes, { prefix: '/api/requests' });
  await app.register(mediaRoutes, { prefix: '/api/media' });
  await app.register(radarrSonarrRoutes, { prefix: '/api/services' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(setupStatusRoutes, { prefix: '/api/setup' });
  if (!isInstalled()) {
    await app.register(setupRoutes, { prefix: '/api/setup' });
  }
  await app.register(appRoutes, { prefix: '/api/app' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(pushRoutes, { prefix: '/api/push' });
  await app.register((await import('../routes/webhooks.js')).webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(seerrRoutes, { prefix: '/api/v1' });
}
