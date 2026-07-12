import crypto from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../utils/prisma.js';
import { getAppSettings, patchAppSettings } from '../../../utils/appSettings.js';
import { getServiceDefinition } from '../../../providers/index.js';
import { logEvent } from '../../../utils/logEvent.js';
import { parseId } from '../../../utils/params.js';
import { parseServiceConfig } from '../../../utils/services.js';

/** Split a Host header value into hostname + port suffix (`:1234` or empty).
 *  Handles bracketed IPv6 (`[::1]:5173` → `::1` + `:5173`) and bare IPv6 (`::1` → `::1` + ``). */
function extractHostname(hostHeader: string): { hostname: string; port: string } {
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    if (end > 0) return { hostname: hostHeader.slice(1, end), port: hostHeader.slice(end + 1) };
  }
  // 2+ colons → bare IPv6 with no port (e.g. `::1`). Treat the whole string as hostname.
  if ((hostHeader.match(/:/g) ?? []).length >= 2) return { hostname: hostHeader, port: '' };
  const colonIdx = hostHeader.indexOf(':');
  if (colonIdx < 0) return { hostname: hostHeader, port: '' };
  return { hostname: hostHeader.slice(0, colonIdx), port: hostHeader.slice(colonIdx) };
}

/** Exact-match loopback hostname test. Boundary-anchored so `localhost.evil.com` doesn't match. */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/** First non-internal IPv4 from a non-tunnel interface, or null. Tunnel-style names
 *  (utun, tun, tap, wg, gif, stf — covers macOS/Linux VPN conventions) are sorted last so a
 *  Tailscale/WireGuard address is only picked when nothing else qualifies. */
function pickLanIpv4(): string | null {
  const interfaces = networkInterfaces();
  const isTunnel = (name: string) => /^(utun|tun|tap|wg|gif|stf)/i.test(name);
  const sortedNames = Object.keys(interfaces).sort((a, b) => Number(isTunnel(a)) - Number(isTunnel(b)));
  for (const name of sortedNames) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

/** Replace a loopback Host header (localhost / 127.x.x.x / ::1) with a LAN-reachable IPv4 so
 *  Radarr/Sonarr can call back the webhook from a Docker container or another LAN host. Keeps
 *  the port intact. Returns the input unchanged when nothing usable is found. */
function swapLoopbackForLan(host: string): string {
  const { hostname, port } = extractHostname(host);
  if (!isLoopbackHostname(hostname)) return host;
  const lan = pickLanIpv4();
  return lan ? `${lan}${port}` : host;
}

/** Mint a new webhook secret on first need. Stored in `AppSettings.apiKey` (legacy field
 *  kept alive for the /webhooks callback auth) and reused for every subsequent enable. */
async function ensureWebhookSecret(): Promise<string> {
  const settings = await getAppSettings();
  if (settings?.apiKey) return settings.apiKey;
  const apiKey = crypto.randomBytes(32).toString('hex');
  await patchAppSettings({ apiKey });
  logEvent('info', 'Webhook', 'Generated webhook callback secret (AppSettings.apiKey)');
  return apiKey;
}

/** Per-service webhook registration — status probe, enable (register on the *arr server and
 *  persist the returned ID on the Service row), disable (remove on the *arr side, null the ID).
 *  The URL returned to the admin uses siteUrl when configured, otherwise derives from the
 *  incoming request's forwarded host so an *arr instance can reach Oscarr without manual config. */
export async function servicesWebhookRoutes(app: FastifyInstance) {
  app.get('/services/:id/webhook/status', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const serviceId = parseId((request.params as { id: string }).id);
    if (!serviceId) return reply.status(400).send({ error: 'Invalid ID' });

    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!svc) return reply.status(404).send({ error: 'Service not found' });

    const config = parseServiceConfig(svc.config);
    const def = getServiceDefinition(svc.type);
    let client: ReturnType<NonNullable<NonNullable<typeof def>['createClient']>> | null = null;
    let serviceReachable = true;
    try {
      client = def?.createClient?.(config) ?? null;
    } catch { /* createClient failed — service type doesn't support webhooks */ }

    const settings = await getAppSettings();
    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = swapLoopbackForLan(String(request.headers['x-forwarded-host'] || request.headers.host || ''));
    const baseUrl = settings?.siteUrl || `${protocol}://${host}`;

    // Verify the webhook still exists on the *arr side; orphaned ID means the admin removed it
    // manually in Radarr/Sonarr — null it locally so the UI reflects reality.
    if (svc.webhookId && client?.checkWebhookExists) {
      try {
        const exists = await client.checkWebhookExists(svc.webhookId);
        if (!exists) {
          await prisma.service.update({ where: { id: serviceId }, data: { webhookId: null } });
          svc.webhookId = null;
        }
      } catch { serviceReachable = false; }
    }

    return {
      enabled: !!svc.webhookId,
      webhookId: svc.webhookId,
      serviceReachable,
      url: `${baseUrl.replace(/\/$/, '')}/api/webhooks/${svc.type}`,
      events: client?.getWebhookEvents?.() || [],
      supportsWebhooks: !!(client?.parseWebhookPayload && client?.registerWebhook),
    };
  });

  app.post('/services/:id/webhook/enable', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const serviceId = parseId((request.params as { id: string }).id);
    if (!serviceId) return reply.status(400).send({ error: 'Invalid ID' });

    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!svc) return reply.status(404).send({ error: 'Service not found' });
    if (svc.webhookId) return reply.status(409).send({ error: 'Webhook already enabled', webhookId: svc.webhookId });

    const config = parseServiceConfig(svc.config);
    const def = getServiceDefinition(svc.type);
    if (!def?.createClient) return reply.status(400).send({ error: 'Service does not support webhooks' });

    const client = def.createClient(config);
    if (!client.registerWebhook) return reply.status(400).send({ error: 'Service does not support webhooks' });

    const apiKey = await ensureWebhookSecret();
    const settings = await getAppSettings();

    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = swapLoopbackForLan(String(request.headers['x-forwarded-host'] || request.headers.host || ''));
    const baseUrl = settings?.siteUrl || `${protocol}://${host}`;
    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/${svc.type}`;

    try {
      const webhookId = await client.registerWebhook('Oscarr', webhookUrl, apiKey);
      try {
        await prisma.service.update({ where: { id: serviceId }, data: { webhookId } });
      } catch (dbErr) {
        // Rollback: the *arr side registered the webhook but our DB write failed — remove the
        // orphan on the *arr to keep the two sides consistent.
        await client.removeWebhook?.(webhookId).catch(() => {});
        throw dbErr;
      }
      logEvent('info', 'Webhook', `Webhook enabled for ${svc.name} (ID: ${webhookId})`);
      return { ok: true, webhookId };
    } catch (err) {
      const axiosErr = err as { response?: { status?: number; data?: unknown }; config?: { url?: string } };
      const responseBody = axiosErr.response?.data;
      const detail = err instanceof Error ? err.message : String(err);
      const bodyDump = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      logEvent('debug', 'Webhook', `Failed to register webhook for ${svc.name} (${axiosErr.config?.url}): ${detail} — body: ${bodyDump?.slice(0, 500)}`);
      return reply.status(502).send({ error: 'WEBHOOK_REGISTER_FAILED', detail: bodyDump ? `${detail} — ${bodyDump.slice(0, 200)}` : detail });
    }
  });

  app.post('/services/:id/webhook/disable', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const serviceId = parseId((request.params as { id: string }).id);
    if (!serviceId) return reply.status(400).send({ error: 'Invalid ID' });

    const svc = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!svc) return reply.status(404).send({ error: 'Service not found' });
    if (!svc.webhookId) return reply.send({ ok: true, message: 'Webhook already disabled' });

    const config = parseServiceConfig(svc.config);
    const def = getServiceDefinition(svc.type);
    const client = def?.createClient?.(config);

    if (client?.removeWebhook) {
      try {
        await client.removeWebhook(svc.webhookId);
      } catch (err) {
        // *arr unreachable — null the DB anyway so the UI doesn't stay stuck on "enabled"; admin
        // can garbage-collect the orphan on the *arr side manually if it ever comes back.
        logEvent('debug', 'Webhook', `Failed to remove webhook ${svc.webhookId} from ${svc.name}: ${err}`);
      }
    }

    await prisma.service.update({ where: { id: serviceId }, data: { webhookId: null } });
    logEvent('info', 'Webhook', `Webhook disabled for ${svc.name}`);
    return { ok: true };
  });
}
