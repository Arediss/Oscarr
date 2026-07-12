import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import axios from 'axios';
import crypto from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { getAppSettings, parseInstanceLanguages } from '../utils/appSettings.js';
import { pluginEngine } from '../plugins/engine.js';
import { getArrClient } from '../providers/index.js';
import { getServiceConfig } from '../utils/services.js';
import { isQualityAllowedForRole } from '../utils/qualityAccess.js';
import { PROJECT_PACKAGE_JSON } from '../utils/paths.js';
import { getHomepageLayout } from './admin/homepage.js';

const APP_VERSION = JSON.parse(
  readFileSync(PROJECT_PACKAGE_JSON, 'utf-8')
).version as string;

export async function appRoutes(app: FastifyInstance) {
  app.get('/version', async (request, reply) => {
    const clientV = request.cookies?.oscarr_v;
    if (clientV && clientV !== APP_VERSION) {
      reply.header('Clear-Site-Data', '"cache"');
    }
    reply.setCookie('oscarr_v', APP_VERSION, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
    const result: { current: string; latest?: string; updateAvailable?: boolean; releaseUrl?: string } = {
      current: APP_VERSION,
    };
    try {
      const { data } = await axios.get('https://raw.githubusercontent.com/arediss/Oscarr/main/version.json', {
        timeout: 5000,
      });
      result.latest = data.latest;
      result.updateAvailable = data.latest !== APP_VERSION;
      result.releaseUrl = data.releaseUrl;
    } catch {
      // GitHub unreachable
    }
    return result;
  });

  // Get changelog from DB patchnotes
  app.get('/changelog', async (request) => {
    const lang = ((request.headers['accept-language'] || '').split(',')[0]?.split('-')[0] || 'en').toLowerCase();
    const patchnotes = await prisma.patchnote.findMany({ orderBy: { date: 'desc' }, take: 15 });
    return {
      current: APP_VERSION,
      releases: patchnotes.map(p => {
        const entries = JSON.parse(p.entries) as { type: string; titleEn: string; titleFr: string; descEn?: string; descFr?: string }[];
        return {
          version: p.version,
          type: p.type,
          title: lang === 'fr' ? p.titleFr : p.titleEn,
          date: p.date.toISOString(),
          entries: entries.map(e => ({
            type: e.type,
            title: lang === 'fr' ? e.titleFr : e.titleEn,
            description: lang === 'fr' ? (e.descFr || null) : (e.descEn || null),
          })),
        };
      }),
    };
  });

  // Get incident banner (no auth — displayed before login)
  app.get('/banner', async () => {
    const settings = await getAppSettings();
    return { banner: settings?.incidentBanner || null };
  });

  // Quality options available for requests (only those with at least one mapping)
  app.get('/quality-options', async (request) => {
    const user = request.user;
    const options = await prisma.qualityOption.findMany({
      where: { mappings: { some: {} } },
      orderBy: { position: 'asc' },
    });
    if (!user || user.role === 'admin') return options;
    return options.filter(opt => isQualityAllowedForRole(opt.allowedRoles, user.role));
  });

  // ─── Health check (authenticated via API key) ─────────────────────
  app.get('/health', async (request, reply) => {
    const apiKey = (request.headers['x-api-key'] as string)
      || (request.headers.authorization?.replace(/^Bearer\s+/i, ''));

    if (!apiKey) {
      return reply.status(401).send({ error: 'API key required (X-Api-Key header or Authorization: Bearer)' });
    }

    const settings = await getAppSettings();
    if (!settings?.apiKey) {
      return reply.status(403).send({ error: 'Invalid API key' });
    }
    const provided = Buffer.from(apiKey);
    const stored = Buffer.from(settings.apiKey);
    if (provided.length !== stored.length || !crypto.timingSafeEqual(provided, stored)) {
      return reply.status(403).send({ error: 'Invalid API key' });
    }

    const uptime = process.uptime();
    const services: Record<string, { online: boolean; version?: string }> = {};

    // Check each configured arr service
    for (const type of ['radarr', 'sonarr']) {
      const config = await getServiceConfig(type);
      if (!config) continue;
      try {
        const client = await getArrClient(type);
        const status = await client.getSystemStatus();
        services[type] = { online: true, version: status.version };
      } catch {
        services[type] = { online: false };
      }
    }

    return {
      status: 'ok',
      version: APP_VERSION,
      uptime: Math.floor(uptime),
      database: 'ok',
      services,
    };
  });

  // Get feature flags (no auth — needed by Layout before auth check).
  // `instanceLanguage` drives the frontend UI locale in prod: the user-facing language switcher
  // is dev-only (see UserCluster), so the instance-wide setting is what everyone actually sees.
  app.get('/features', async () => {
    const settings = await getAppSettings();
    const pluginFeatures = pluginEngine.getAllFeatureFlags();
    const languages = parseInstanceLanguages(settings?.instanceLanguages);
    // Custom links (#167) shipped with the features payload so the Layout topbar has them at
    // mount without a second round-trip. Bad JSON falls back to an empty list — admins fix it
    // via the editor without breaking the page.
    let customLinks: Array<{ id: string; label: string; url: string; icon: string; position: 'left' | 'right'; order: number }> = [];
    try {
      const parsed = settings?.customLinks ? JSON.parse(settings.customLinks) : [];
      if (Array.isArray(parsed)) customLinks = parsed;
    } catch { /* malformed JSON in DB → empty list */ }
    return {
      requestsEnabled: settings?.requestsEnabled ?? true,
      calendarEnabled: settings?.calendarEnabled ?? true,
      siteName: settings?.siteName ?? 'Oscarr',
      nsfwBlurEnabled: settings?.nsfwBlurEnabled ?? true,
      instanceLanguage: languages[0] ?? 'en',
      customLinks,
      ...pluginFeatures,
    };
  });

  // Get homepage layout (public — needed before auth)
  app.get('/homepage-layout', async () => {
    return getHomepageLayout();
  });

  // Get VAPID public key for push notifications (public — needed before subscription)
  app.get('/vapid-key', async () => {
    return { key: process.env.VAPID_PUBLIC_KEY || null };
  });
}
