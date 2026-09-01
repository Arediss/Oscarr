import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { patchAppSettings } from '../utils/appSettings.js';
import { logEvent } from '../utils/logEvent.js';
import { runFullSync } from '../services/sync/index.js';
import { initScheduler } from '../services/scheduler.js';
import { parseServiceConfig, serializeServiceConfig } from '../utils/services.js';
import { isInstalled, markInstalled } from '../utils/install.js';
import { classifyTestError } from '../utils/serviceTestError.js';
import { assertPublicUrl, SsrfBlockedError } from '../utils/ssrfGuard.js';
import { isSensitiveKey } from '../utils/secrets.js';
import { registerEmail } from '../providers/email/index.js';
import { buildHelpers } from './auth.js';

// Strength is checked once at boot by assertSetupSecretOrExit (utils/envSecret.ts), which refuses
// to start a not-yet-installed instance on a weak value. The old warning here fired before that
// check, claimed the setup routes were "unprotected" (they answer 500, and aren't even mounted
// once installed), and used a threshold half the real one.
const SETUP_SECRET = process.env.SETUP_SECRET || '';

async function requireNotInstalled(_request: FastifyRequest, reply: FastifyReply) {
  if (isInstalled()) {
    return reply.status(403).send({ error: 'Installation already completed' });
  }
}

async function requireSetupSecret(request: FastifyRequest, reply: FastifyReply) {
  if (!SETUP_SECRET) {
    return reply.status(500).send({ error: 'SETUP_SECRET not configured in .env' });
  }
  const token = request.headers['x-setup-secret'];
  if (token !== SETUP_SECRET) {
    return reply.status(401).send({ error: 'Invalid setup secret' });
  }
}

/** Always-on status endpoint — frontend needs it before anything else. */
export async function setupStatusRoutes(app: FastifyInstance) {
  app.get('/install-status', async () => {
    return { installed: isInstalled() };
  });
}

export async function setupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    await requireNotInstalled(request, reply);
    await requireSetupSecret(request, reply);
  });

  // Verify setup secret — lightweight check for the frontend.
  // Also reports whether an admin already exists: the wizard may have been interrupted between
  // account creation (step 1) and final sync (step 4), so a returning user needs to sign in
  // with the existing admin credentials instead of re-registering. adminExists drives the UI
  // branch in step 1 of InstallPage.
  app.post('/verify-secret', async () => {
    const adminExists = (await prisma.user.count({ where: { role: 'admin' } })) > 0;
    return { ok: true, adminExists };
  });

  // ─── First admin ────────────────────────────────────────────────
  // The instance owner is created here, not on the public /api/auth/register, so minting the
  // one account that owns the instance requires proving possession of SETUP_SECRET (enforced by
  // this router's preHandler). /api/auth/register refuses outright while the user table is empty.
  //
  // Single-flight: two concurrent calls must not both read "no users" and both create an admin.
  // SQLite gives us no lock that spans a read-then-write, but the process is single-threaded, so
  // chaining every attempt onto one promise is a real mutex here.
  let bootstrapChain: Promise<unknown> = Promise.resolve();

  app.post('/admin', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object' as const,
        required: ['email', 'password', 'displayName'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
          displayName: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, displayName } = request.body as { email: string; password: string; displayName: string };

    const attempt = bootstrapChain.then(async (): Promise<{ status: number; error: string } | { userId: number }> => {
      if ((await prisma.user.count()) > 0) {
        return { status: 409, error: 'ADMIN_EXISTS' };
      }
      try {
        const result = await registerEmail(email, password, displayName);
        const user = await prisma.user.create({
          data: {
            email: result.email,
            displayName: result.displayName,
            passwordHash: result.providerData.passwordHash as string,
            role: 'admin',
            providers: { create: { provider: 'email', providerId: result.email, providerUsername: result.displayName, providerEmail: result.email } },
          },
        });
        logEvent('info', 'Setup', `Instance admin created during installation: ${result.displayName}`);
        return { userId: user.id };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'EMAIL_EXISTS') return { status: 409, error: 'EMAIL_EXISTS' };
        if (msg === 'PASSWORD_TOO_SHORT') return { status: 400, error: 'PASSWORD_TOO_SHORT' };
        if (msg === 'DISPLAY_NAME_REQUIRED') return { status: 400, error: 'DISPLAY_NAME_REQUIRED' };
        throw err;
      }
    });
    // Keep the chain alive whatever happens, so one failure doesn't wedge later attempts.
    bootstrapChain = attempt.catch(() => undefined);

    const outcome = await attempt;
    if ('error' in outcome) return reply.status(outcome.status).send({ error: outcome.error });
    return buildHelpers(app).signAndSend(reply, outcome.userId);
  });

  // Service schemas — used by wizard to build dynamic forms
  app.get('/service-schemas', async () => {
    const { getServiceSchemas } = await import('../providers/index.js');
    return getServiceSchemas();
  });

  // Plex OAuth for setup — just get a token without creating a user
  app.post('/plex-pin', async (_request, reply) => {
    const { plexCreatePin } = await import('../providers/plex/index.js');
    const result = await plexCreatePin();
    return reply.send(result);
  });

  app.post('/plex-check', {
    schema: {
      body: {
        type: 'object',
        required: ['pinId'],
        properties: {
          pinId: { type: 'number', description: 'Plex PIN ID to check' },
        },
      },
    },
  }, async (request, reply) => {
    const { pinId } = request.body as { pinId: number };
    if (!pinId) return reply.status(400).send({ error: 'pinId required' });
    const { plexCheckPin } = await import('../providers/plex/index.js');
    const authToken = await plexCheckPin(pinId);
    if (!authToken) return reply.status(400).send({ error: 'PIN not validated' });
    return reply.send({ token: authToken });
  });

  // Proxied Plex /identity probe — CSP connect-src 'self' blocks a direct browser fetch to the
  // LAN Plex URL, so the wizard asks us to do it server-side and return just the machineId.
  app.post('/plex-identity', {
    schema: {
      body: {
        type: 'object',
        required: ['url', 'token'],
        properties: {
          url: { type: 'string', description: 'Plex server URL (http://host:32400)' },
          token: { type: 'string', description: 'Plex auth token (from /plex-check)' },
        },
      },
    },
  }, async (request, reply) => {
    const { url, token } = request.body as { url: string; token: string };
    // SSRF guard: admin-typed URL goes straight to axios.get. Permissive by default for
    // self-hosted LAN setups (OSCARR_BLOCK_PRIVATE_SERVICES !== 'true'), strict mode refuses
    // private ranges so a shared-hosting operator can't be tricked into probing RFC1918.
    try {
      await assertPublicUrl(url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return reply.status(400).send({ error: 'URL_BLOCKED_BY_SSRF_GUARD', detail: err.message });
      }
      throw err;
    }
    const { plexFetchMachineId } = await import('../providers/plex/index.js');
    try {
      const machineId = await plexFetchMachineId(url, token);
      if (!machineId) return reply.status(502).send({ error: 'Plex did not return a machineIdentifier' });
      return reply.send({ machineId });
    } catch (err) {
      const info = classifyTestError(err);
      return reply.status(502).send({ error: info.code, detail: info.message });
    }
  });

  // Test any service during setup (uses the service registry)
  app.post('/test-service', {
    schema: {
      body: {
        type: 'object',
        required: ['type', 'config'],
        properties: {
          type: { type: 'string', description: 'Service type (radarr, sonarr, plex, etc.)' },
          config: { type: 'object', description: 'Service config fields', additionalProperties: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { type, config } = request.body as { type: string; config: Record<string, string> };
    const { getServiceDefinition } = await import('../providers/index.js');
    const def = getServiceDefinition(type);
    if (!def) return reply.status(400).send({ error: 'Unsupported service type' });

    try {
      return await def.test(config);
    } catch (err) {
      const info = classifyTestError(err);
      logEvent('warn', 'Setup', `Service test failed (${type}): ${info.code} — ${info.message}`, err);
      return reply.status(502).send({ error: info.code, detail: info.message });
    }
  });

  /** Services already saved, so a resumed wizard shows what is configured instead of a blank
   *  form. Secret fields are stripped — the wizard only needs to know a service exists. */
  app.get('/services', async () => {
    const services = await prisma.service.findMany({ orderBy: { id: 'asc' } });
    return services.map((s) => {
      const config = parseServiceConfig(s.config);
      const safe: Record<string, string> = {};
      for (const [k, v] of Object.entries(config)) {
        safe[k] = isSensitiveKey(k) ? '' : v;
      }
      return { id: s.id, name: s.name, type: s.type, enabled: s.enabled, config: safe };
    });
  });

  // Add any service during setup
  app.post('/service', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type', 'config'],
        properties: {
          name: { type: 'string', description: 'Display name for the service' },
          type: { type: 'string', description: 'Service type' },
          config: { type: 'object', description: 'Service config fields', additionalProperties: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { name, type, config } = request.body as { name: string; type: string; config: Record<string, string> };
    if (!name || !type || !config) {
      return reply.status(400).send({ error: 'All fields are required' });
    }

    // Idempotent on (type, url). The wizard keeps its services in React state only, so a page
    // refresh restarts it empty while the rows it already saved are still in the database —
    // creating unconditionally then added every service a second time.
    const existing = await findServiceByTypeAndUrl(type, config.url);
    const data = {
      name,
      type,
      config: serializeServiceConfig(config),
      isDefault: true,
      enabled: true,
    };
    const service = existing
      ? await prisma.service.update({ where: { id: existing.id }, data })
      : await prisma.service.create({ data });

    // If Plex with machineId, store in AppSettings
    if (type === 'plex' && config.machineId) {
      await patchAppSettings({ plexMachineId: config.machineId });
    }

    logEvent('info', 'Setup', `Service "${name}" (${type}) added during installation`);
    return reply.status(201).send({ ok: true, service: { ...service, config: parseServiceConfig(service.config) } });
  });

  // Run first full sync during install — marks installation as complete
  app.post('/sync', async (_request, reply) => {
    const arrService = await prisma.service.findFirst({
      where: { type: { in: ['radarr', 'sonarr'] }, enabled: true },
    });
    if (!arrService) {
      return reply.status(400).send({ error: 'Configure at least one Radarr or Sonarr service' });
    }

    // Without this the wizard could be driven API-side straight to /sync, marking the instance
    // installed with no admin — /api/setup/* would then be unmounted, leaving no guarded path to
    // create one.
    if ((await prisma.user.count({ where: { role: 'admin' } })) === 0) {
      return reply.status(400).send({ error: 'ADMIN_REQUIRED' });
    }

    try {
      const result = await runFullSync();
      await initScheduler();
      markInstalled();
      logEvent('info', 'Setup', 'First full sync completed');
      // No process exit — the setup preHandler now 403s every /setup/* call once
      // `isInstalled()` flips, so the routes are effectively dead in place. Avoids
      // requiring an external supervisor (docker --restart, systemd, …) just to
      // come back online after install.
      return { ok: true, result };
    } catch (err) {
      return reply.status(500).send({ error: 'Sync failed', details: String(err) });
    }
  });
}

/** Matches on the service's URL when it has one, falling back to type alone for connectors that
 *  are single-instance by nature. Configs are encrypted, so the comparison happens after decrypt
 *  rather than in SQL. */
async function findServiceByTypeAndUrl(type: string, url: string | undefined) {
  const candidates = await prisma.service.findMany({ where: { type } });
  if (candidates.length === 0) return null;
  if (!url) return candidates[0];
  const target = url.replace(/\/+$/, '');
  return candidates.find((c) => {
    try {
      return (parseServiceConfig(c.config).url ?? '').replace(/\/+$/, '') === target;
    } catch {
      return false;
    }
  }) ?? null;
}
