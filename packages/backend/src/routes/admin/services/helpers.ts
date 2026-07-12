import type { FastifyInstance, FastifyReply } from 'fastify';
import { getServiceById } from '../../../utils/services.js';
import { getAuthProvider, getArrClient, createArrClient, getServiceDefinition, type ArrClient } from '../../../providers/index.js';
import { plexCreatePin, plexCheckPin, plexFetchMachineId } from '../../../providers/plex/index.js';
import { parseId } from '../../../utils/params.js';
import { classifyTestError } from '../../../utils/serviceTestError.js';
import { assertPublicUrl, SsrfBlockedError } from '../../../utils/ssrfGuard.js';

/** Call an *arr method via the default client; on failure answer 502 and return undefined so the
 *  handler can `return` it directly (Fastify ignores the undefined return once the reply is sent). */
async function reachArr<T>(reply: FastifyReply, serviceType: string, call: (client: ArrClient) => Promise<T>): Promise<T | undefined> {
  try {
    return await call(await getArrClient(serviceType));
  } catch {
    const label = getServiceDefinition(serviceType)?.label ?? serviceType;
    reply.status(502).send({ error: `Unable to reach ${label}` });
    return undefined;
  }
}

/** Service-config helpers — Plex token passthrough + quality profile / root folder lookups.
 *
 *  The top-level `/radarr/*` and `/sonarr/*` routes target the current default *arr client
 *  (used by the homepage + quick setup). The `/services/:id/*` variants target a specific
 *  service row (used by the admin's quality-mapping editor, which can map one option across
 *  several *arr installs). Both flavors stay here since they share the same provider layer. */
export async function servicesHelperRoutes(app: FastifyInstance) {
  app.get('/plex-token', async (request, reply) => {
    const provider = getAuthProvider('plex');
    if (!provider?.getToken) return reply.status(404).send({ error: 'Plex provider not available' });
    const adminUser = request.user;
    const token = await provider.getToken(adminUser.id);
    if (!token) return reply.status(404).send({ error: 'No Plex token found' });
    return { token };
  });

  /** PIN-based Plex OAuth for admins configuring a new Plex service. Mirrors /setup/plex-pin +
   *  /setup/plex-check but lives behind admin auth so it's always available — not just during
   *  install, and independent of whether the admin linked Plex as an auth provider. */
  app.post('/plex-pin', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async () => {
    return plexCreatePin();
  });

  app.post('/plex-check', {
    config: { rateLimit: { max: 120, timeWindow: '2 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['pinId'],
        properties: { pinId: { type: 'number', description: 'Plex PIN ID to check' } },
      },
    },
  }, async (request, reply) => {
    const { pinId } = request.body as { pinId: number };
    const token = await plexCheckPin(pinId);
    if (!token) return reply.status(400).send({ error: 'PIN not validated' });
    return { token };
  });

  /** Proxied Plex /identity probe — same reason as /setup/plex-identity: CSP blocks the browser
   *  from hitting the LAN Plex URL directly, so the admin ServiceModal asks us to fetch
   *  machineIdentifier server-side. */
  app.post('/plex-identity', {
    schema: {
      body: {
        type: 'object',
        required: ['url', 'token'],
        properties: {
          url: { type: 'string', description: 'Plex server URL (http://host:32400)' },
          token: { type: 'string', description: 'Plex auth token' },
        },
      },
    },
  }, async (request, reply) => {
    const { url, token } = request.body as { url: string; token: string };
    // Same SSRF guard as /setup/plex-identity — admin-typed URL, permissive by default,
    // strict mode (OSCARR_BLOCK_PRIVATE_SERVICES=true) refuses RFC1918 ranges.
    try {
      await assertPublicUrl(url);
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        return reply.status(400).send({ error: 'URL_BLOCKED_BY_SSRF_GUARD', detail: err.message });
      }
      throw err;
    }
    try {
      const machineId = await plexFetchMachineId(url, token);
      if (!machineId) return reply.status(502).send({ error: 'Plex did not return a machineIdentifier' });
      return { machineId };
    } catch (err) {
      const info = classifyTestError(err);
      return reply.status(502).send({ error: info.code, detail: info.message });
    }
  });

  app.get('/radarr/profiles', (_request, reply) => reachArr(reply, 'radarr', (c) => c.getQualityProfiles()));
  app.get('/radarr/rootfolders', (_request, reply) => reachArr(reply, 'radarr', (c) => c.getRootFolders()));
  app.get('/sonarr/profiles', (_request, reply) => reachArr(reply, 'sonarr', (c) => c.getQualityProfiles()));
  app.get('/sonarr/rootfolders', (_request, reply) => reachArr(reply, 'sonarr', (c) => c.getRootFolders()));

  app.get('/services/:id/profiles', {
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
    const svc = await getServiceById(serviceId);
    if (!svc) return reply.status(404).send({ error: 'Service not found or disabled' });
    try {
      const client = createArrClient(svc.type, svc.config);
      return await client.getQualityProfiles();
    } catch (err) {
      if (err instanceof Error && err.message.includes('does not support client creation')) {
        return reply.status(400).send({ error: 'This service type does not support quality profiles' });
      }
      return reply.status(502).send({ error: 'Unable to reach the service' });
    }
  });

  app.get('/services/:id/rootfolders', {
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
    const svc = await getServiceById(serviceId);
    if (!svc) return reply.status(404).send({ error: 'Service not found or disabled' });
    try {
      const client = createArrClient(svc.type, svc.config);
      return await client.getRootFolders();
    } catch (err) {
      if (err instanceof Error && err.message.includes('does not support client creation')) {
        return reply.status(400).send({ error: 'This service type does not support root folders' });
      }
      return reply.status(502).send({ error: 'Unable to reach the service' });
    }
  });
}
