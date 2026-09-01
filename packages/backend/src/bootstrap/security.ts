import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { rbacPlugin } from '../middleware/rbac.js';
import { logEvent } from '../utils/logEvent.js';
import { maintenanceReason } from '../utils/maintenance.js';

/** Security layer: headers, CORS, cookies, JWT, rate-limit, CSRF gate, RBAC. */
export async function registerSecurity(app: FastifyInstance) {
  const forceHttps = process.env.FORCE_HTTPS === 'true';
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Strict: only same-origin scripts + the static importmap hash (plugin runtime resolution
        // for react / react-dom / @oscarr/sdk). Update if packages/frontend/index.html changes.
        scriptSrc: ["'self'", "'sha256-faXwVQbBGEbFozbVLtyhAzVuniTmTwA/WN/tTKNJ88g='"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Permissive: any HTTPS image is allowed. <img> can't execute code, and the alternative
        // (allowlisting plex.tv / discord / jellyfin / emby / radarr / sonarr / future providers
        // / user-uploaded TMDB-mirror endpoints) creates ongoing CSP friction with no real
        // security benefit on a self-hosted, reverse-proxied app.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https://api.themoviedb.org', 'https://image.tmdb.org'],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: forceHttps ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
    frameguard: { action: 'deny' },
    noSniff: true,
  });

  await app.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET environment variable is required');

  await app.register(cookie);
  await app.register(jwt, {
    secret: jwtSecret,
    cookie: { cookieName: 'token', signed: false },
  });
  await app.register(rateLimit, { global: false });

  // Maintenance latch — held while a restore swaps the database file. Answering 503 here beats
  // letting handlers hit a disconnected Prisma client mid-swap.
  app.addHook('onRequest', async (request, reply) => {
    const why = maintenanceReason();
    if (!why) return;
    if (!request.url.startsWith('/api/')) return;
    return reply.status(503).header('Retry-After', '15').send({ error: 'MAINTENANCE', reason: why });
  });

  // CSRF gate — /api/admin/* must carry X-Requested-With: oscarr. Custom headers can't be
  // set by a forged cross-origin request.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/admin/')) return;
    if (request.headers['x-requested-with'] === 'oscarr') return;
    return reply.status(403).send({ error: 'CSRF_HEADER_REQUIRED' });
  });

  rbacPlugin(app);

  // Forward unhandled 5xx errors to AppLog so they surface in Admin → System → Logs. 4xx are
  // expected (bad input, auth, not-found) — logging them would flood the table. Fastify still
  // serializes the error to the client; we just pipe a structured copy into the DB.
  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      logEvent('error', 'HTTP', `${request.method} ${request.url} → ${status} · ${err.message}`, err)
        .catch(() => { /* never mask the HTTP error path */ });
    }
    reply.send(err);
  });
}
