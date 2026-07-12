import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../utils/prisma.js';
import { getServiceDefinition, getServiceSchemas } from '../../../providers/index.js';
import { logEvent } from '../../../utils/logEvent.js';
import { parseId } from '../../../utils/params.js';
import { assertPublicUrl, SsrfBlockedError } from '../../../utils/ssrfGuard.js';
import { verifyPassword } from '../../../utils/password.js';
import { classifyTestError } from '../../../utils/serviceTestError.js';
import { parseServiceConfig, serializeServiceConfig } from '../../../utils/services.js';

const MASK = '__MASKED__';

function maskServiceConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const def = getServiceDefinition(type);
  if (!def) return config;
  const out: Record<string, unknown> = { ...config };
  for (const field of def.fields) {
    if (field.type === 'password' && typeof out[field.key] === 'string' && out[field.key]) {
      out[field.key] = MASK;
    }
  }
  return out;
}

/** Merge PATCH with stored config. MASK preserves the stored value, unknown keys are dropped. */
function mergeServiceConfig(
  type: string,
  stored: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const def = getServiceDefinition(type);
  const allowed = new Set(def?.fields.map((f) => f.key) ?? Object.keys(patch));
  const out: Record<string, unknown> = Object.create(null);
  for (const key of allowed) {
    const incoming = patch[key];
    if (incoming === MASK) {
      if (stored[key] !== undefined) out[key] = stored[key];
    } else if (incoming !== undefined) {
      out[key] = incoming;
    } else if (stored[key] !== undefined) {
      out[key] = stored[key];
    }
  }
  return out;
}

/** Service CRUD + connection test. Secrets masked on read, revealed via /config/reveal. */
export async function servicesCrudRoutes(app: FastifyInstance) {
  app.get('/service-schemas', async () => getServiceSchemas());

  app.get('/services', async () => {
    const services = await prisma.service.findMany({ orderBy: { createdAt: 'asc' } });
    return services.map((s) => ({
      ...s,
      config: maskServiceConfig(s.type, parseServiceConfig(s.config) as Record<string, unknown>),
    }));
  });

  // Password re-auth to reveal stored secrets — same posture as /backup/restore.
  app.post('/services/:id/config/reveal', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'Service ID' } },
      },
      body: {
        type: 'object',
        required: ['password'],
        properties: { password: { type: 'string', description: 'Admin password re-auth' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { password } = request.body as { password: string };
    const serviceId = parseId(id);
    if (!serviceId) return reply.status(400).send({ error: 'INVALID_ID' });
    if (!password || typeof password !== 'string') {
      return reply.status(400).send({ error: 'PASSWORD_REQUIRED' });
    }

    const actor = request.user;
    const adminUser = await prisma.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } });
    if (!adminUser?.passwordHash) return reply.status(400).send({ error: 'ADMIN_HAS_NO_PASSWORD' });
    const passwordOk = await verifyPassword(password, adminUser.passwordHash);
    if (!passwordOk) {
      logEvent('warn', 'Service', `Reveal rejected: wrong password (user ${actor.id})`);
      return reply.status(401).send({ error: 'INVALID_PASSWORD' });
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return reply.status(404).send({ error: 'SERVICE_NOT_FOUND' });
    logEvent('warn', 'Service', `Service "${service.name}" config revealed (user ${actor.id})`);
    return { config: parseServiceConfig(service.config) as Record<string, unknown> };
  });

  app.post('/services', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type', 'config'],
        properties: {
          name: { type: 'string', description: 'Service display name' },
          type: { type: 'string', description: 'Service type (radarr, sonarr, plex, qbittorrent, tautulli, trackarr)' },
          config: { type: 'object', description: 'Service-specific configuration (url, apiKey, token, etc.)' },
          isDefault: { type: 'boolean', description: 'Set as the default service for its type' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, type, config, isDefault } = request.body as {
      name: string; type: string; config: Record<string, string>; isDefault?: boolean;
    };
    if (!name || !type || !config) {
      return reply.status(400).send({ error: 'Name, type and config required' });
    }
    if (typeof config.url === 'string' && config.url) {
      try { await assertPublicUrl(config.url); }
      catch (err) {
        if (err instanceof SsrfBlockedError) return reply.status(400).send({ error: 'URL_BLOCKED_BY_SSRF_GUARD', detail: err.message });
        throw err;
      }
    }
    // Only one default per type — clear the previous one before setting this.
    if (isDefault) {
      await prisma.service.updateMany({ where: { type, isDefault: true }, data: { isDefault: false } });
    }
    const service = await prisma.service.create({
      data: { name, type, config: serializeServiceConfig(config), isDefault: isDefault ?? false },
    });
    logEvent('info', 'Service', `Service "${name}" (${type}) added`);
    return reply.status(201).send({ ...service, config: maskServiceConfig(service.type, parseServiceConfig(service.config) as Record<string, unknown>) });
  });

  app.put('/services/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'Service ID' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Service display name' },
          config: { type: 'object', description: 'Service-specific configuration' },
          isDefault: { type: 'boolean', description: 'Set as the default service for its type' },
          enabled: { type: 'boolean', description: 'Enable or disable the service' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const serviceId = parseId(id);
    if (!serviceId) return reply.status(400).send({ error: 'Invalid ID' });
    const { name, config, isDefault, enabled } = request.body as {
      name?: string; config?: Record<string, string>; isDefault?: boolean; enabled?: boolean;
    };
    const existing = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!existing) return reply.status(404).send({ error: 'Service not found' });

    if (isDefault) {
      await prisma.service.updateMany({ where: { type: existing.type, isDefault: true, NOT: { id: serviceId } }, data: { isDefault: false } });
    }

    let mergedConfig: string | undefined;
    if (config !== undefined) {
      // Decrypt before merge so MASK-replacement compares against the actual stored value, not
      // an `enc:v1:` ciphertext that no patch field could ever match.
      const stored = parseServiceConfig(existing.config) as Record<string, unknown>;
      const merged = mergeServiceConfig(existing.type, stored, config as Record<string, unknown>);
      if (typeof merged.url === 'string' && merged.url) {
        try { await assertPublicUrl(merged.url); }
        catch (err) {
          if (err instanceof SsrfBlockedError) return reply.status(400).send({ error: 'URL_BLOCKED_BY_SSRF_GUARD', detail: err.message });
          throw err;
        }
      }
      mergedConfig = serializeServiceConfig(merged as Record<string, string>);
    }

    const service = await prisma.service.update({
      where: { id: serviceId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(mergedConfig !== undefined ? { config: mergedConfig } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });
    return { ...service, config: maskServiceConfig(service.type, parseServiceConfig(service.config) as Record<string, unknown>) };
  });

  app.delete('/services/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'Service ID' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const serviceId = parseId(id);
    if (!serviceId) return reply.status(400).send({ error: 'Invalid ID' });
    const deleted = await prisma.service.delete({ where: { id: serviceId } });
    logEvent('info', 'Service', `Service "${deleted.name}" deleted`);
    return { ok: true };
  });

  app.post('/services/:id/test', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', description: 'Service ID' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const serviceId = parseId(id);
    if (!serviceId) return reply.status(400).send({ error: 'Invalid ID' });
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return reply.status(404).send({ error: 'Service not found' });
    const config = parseServiceConfig(service.config);

    const def = getServiceDefinition(service.type);
    if (!def) return reply.status(400).send({ error: 'Test not supported for this service type' });

    if (typeof config.url === 'string' && config.url) {
      try {
        await assertPublicUrl(config.url);
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          return reply.status(400).send({ error: 'URL_BLOCKED_BY_SSRF_GUARD', detail: err.message });
        }
        throw err;
      }
    }

    try {
      return await def.test(config);
    } catch (err) {
      const info = classifyTestError(err);
      logEvent('warn', 'Service', `Test failed for "${service.name}" (${service.type}): ${info.code} — ${info.message}`, err);
      return reply.status(502).send({ error: info.code, detail: info.message });
    }
  });
}
