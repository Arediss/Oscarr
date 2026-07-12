import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getAccessTag } from '../middleware/rbac.js';

/**
 * OpenAPI / Swagger UI at /api/docs, dev-only. The auto-tagging hook attaches each route to
 * its category (derived from the prefix) and its access tier (derived from RBAC).
 * Must be registered BEFORE routes so the onRoute hook catches every addition.
 */
export async function registerDocs(app: FastifyInstance) {
  // Tags are cheap to compute and harmless in prod; registering the hook unconditionally matches
  // the pre-refactor behavior (the hook used to live outside the dev-only swagger gate).
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url.startsWith('/api/docs')) return;
    if (!routeOptions.url.startsWith('/api/')) return;

    const segment = (routeOptions.prefix || '').split('/').filter(Boolean).pop() || 'other';
    const categoryTag = segment.charAt(0).toUpperCase() + segment.slice(1);

    const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
    const accessTag = getAccessTag(methods[0], routeOptions.url);

    routeOptions.schema = { ...routeOptions.schema, tags: [categoryTag, accessTag] };
  });

  if (process.env.NODE_ENV === 'production') return;

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Oscarr API',
        description: 'API documentation for Oscarr — media request management',
        version: '0.1.0-alpha',
      },
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token' },
        },
      },
      security: [{ cookieAuth: [] }],
      tags: [
        { name: 'Public', description: 'No authentication required — open to anyone' },
        { name: 'Auth Required', description: 'Requires a valid JWT session (logged-in user)' },
        { name: 'Admin Only', description: 'Requires admin role — sensitive operations' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
    uiHooks: {
      preHandler: async (request, reply) => {
        try { await request.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
        const user = request.user;
        if (user.role !== 'admin') return reply.status(403).send({ error: 'Admin only' });
      },
    },
  });
}
