import type { FastifyInstance } from 'fastify';
import { getAppSettings } from './appSettings.js';
import { logEvent } from './logEvent.js';
import { scrubSecrets } from './logScrubber.js';

let enabled = false;

export async function refreshVerboseRequestLogFlag(): Promise<void> {
  try {
    const s = await getAppSettings();
    enabled = s?.verboseRequestLog === true;
  } catch {
    // settings table missing on first boot — keep default off
  }
}

export function isVerboseRequestLogEnabled(): boolean {
  return enabled;
}

export function setVerboseRequestLogFlag(value: boolean): void {
  enabled = value;
}

function summarise(url: string, headers: Record<string, unknown>, status: number, location: string | null, ms: number, ip: string): string {
  const safeUrl = scrubSecrets(url);
  const safeLocation = location ? scrubSecrets(location) : null;
  const ua = String(headers['user-agent'] ?? '').slice(0, 80);
  const referer = headers['referer'] ? scrubSecrets(String(headers['referer'])).slice(0, 120) : null;
  const parts = [`${status}`, `${ms}ms`, `ip=${ip}`];
  if (safeLocation) parts.push(`location=${safeLocation}`);
  if (referer) parts.push(`referer=${referer}`);
  if (ua) parts.push(`ua=${ua}`);
  return `${safeUrl} | ${parts.join(' ')}`;
}

export function registerVerboseRequestLog(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    if (!enabled) return;
    const url = request.url;
    if (!url.startsWith('/api/')) return;
    if (url.startsWith('/api/notifications/unread-count')) return;

    const status = reply.statusCode;
    const location = reply.getHeader('location');
    const locStr = typeof location === 'string' ? location : null;
    const ms = Math.round(reply.elapsedTime);
    const ip = request.ip || 'unknown';
    const summary = summarise(url, request.headers as Record<string, unknown>, status, locStr, ms, ip);

    const level: 'info' | 'warn' | 'error' = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logEvent(level, 'RequestLog', `${request.method} ${summary}`).catch(() => { /* best-effort */ });
  });
}
