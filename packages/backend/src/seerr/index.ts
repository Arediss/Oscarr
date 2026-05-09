import type { FastifyInstance } from 'fastify';
import { userApiKeyAuthHook } from '../middleware/userApiKeyAuth.js';
import { statusRoutes } from './routes/status.js';
import { authRoutes } from './routes/auth.js';
import { requestRoutes } from './routes/request.js';
import { movieTvRoutes } from './routes/movieTv.js';
import { searchRoutes } from './routes/search.js';
import { mediaRoutes } from './routes/media.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/user.js';

/**
 * Seerr-compatible API layer. Mounted under /api/v1 to mirror the path third-party clients
 * (Doplarr, Maintainerr, Homarr, Pocket for Seerr, …) hardcode for Overseerr / Jellyseerr /
 * Seerr. RBAC is bypassed for this prefix (PUBLIC marker) so we can own auth via X-Api-Key
 * resolved through UserApiKey instead of JWT.
 *
 * Each endpoint translates an Oscarr internal call into the response shape that Seerr clients
 * expect. Endpoints we haven't implemented yet fall through to a clean 501 catch-all so apps
 * degrade gracefully instead of timing out.
 */
export async function seerrRoutes(app: FastifyInstance) {
  app.addHook('preHandler', userApiKeyAuthHook);

  await statusRoutes(app);
  await authRoutes(app);
  await requestRoutes(app);
  await movieTvRoutes(app);
  await searchRoutes(app);
  await mediaRoutes(app);
  await settingsRoutes(app);
  await userRoutes(app);

  // Catch-all 501 for any Overseerr endpoint we haven't mapped yet. Must be the LAST handler
  // registered on this scope so it doesn't shadow real routes.
  app.all('/*', async (request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: `${request.method} ${request.url} is not implemented by Oscarr's Seerr-compatible API layer yet.`,
      compat: 'seerr',
    });
  });
}
