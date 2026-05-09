import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { logEvent } from '../utils/logEvent.js';
import { runFullSync } from '../services/sync/index.js';
import { initScheduler } from '../services/scheduler.js';
import { parseServiceConfig, serializeServiceConfig } from '../utils/services.js';
import { isInstalled, markInstalled } from '../utils/install.js';
import { classifyTestError } from '../utils/serviceTestError.js';
import { assertPublicUrl, SsrfBlockedError } from '../utils/ssrfGuard.js';

const SETUP_SECRET = process.env.SETUP_SECRET || '';
if (!SETUP_SECRET) {
  console.error('[Setup] SETUP_SECRET is not set — setup routes will be unprotected!');
} else if (SETUP_SECRET.length < 8) {
  console.warn('[Setup] SETUP_SECRET is too short — minimum 8 characters recommended.');
}

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

    const service = await prisma.service.create({
      data: {
        name,
        type,
        config: serializeServiceConfig(config),
        isDefault: true,
        enabled: true,
      },
    });

    // If Plex with machineId, store in AppSettings
    if (type === 'plex' && config.machineId) {
      await prisma.appSettings.upsert({
        where: { id: 1 },
        update: { plexMachineId: config.machineId },
        create: { id: 1, plexMachineId: config.machineId, updatedAt: new Date() },
      });
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

    try {
      const result = await runFullSync();
      await initScheduler();
      markInstalled();
      logEvent('info', 'Setup', 'First full sync completed');
      // Restart so setup routes are physically unmounted (supervisor/docker will respawn).
      setTimeout(() => process.exit(0), 500);
      return { ok: true, result, restarting: true };
    } catch (err) {
      return reply.status(500).send({ error: 'Sync failed', details: String(err) });
    }
  });
}
