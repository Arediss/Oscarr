import type { FastifyInstance } from 'fastify';
import type { AppSettings } from '@prisma/client';
import crypto, { randomUUID } from 'node:crypto';
import { prisma } from '../../utils/prisma.js';
import { getAppSettings, ensureAppSettings, patchAppSettings, parseInstanceLanguages } from '../../utils/appSettings.js';
import { logEvent } from '../../utils/logEvent.js';
import { safeNotify, invalidateSiteUrl } from '../../utils/safeNotify.js';
import { invalidateLanguageCache } from '../../services/tmdb.js';

// Issue #167 — admin-defined external links rendered in the home topbar.
// Strict-https for safety (no http://), short labels (50 chars), icon is either a Lucide name,
// a brand id from the curated list, or an https image URL. Position drives left/right placement
// relative to the topbar search bar.
interface RawCustomLink { id?: unknown; label?: unknown; url?: unknown; icon?: unknown; position?: unknown; order?: unknown }
interface ValidCustomLink { id: string; label: string; url: string; icon: string; position: 'left' | 'right'; order: number }
// Icon shapes accepted: Lucide name (`Settings`), curated brand id (`brand:discord`), or an
// HTTPS image URL. The colon is what `brand:` needs — without it the previous regex rejected
// every brand pick.
const LUCIDE_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const BRAND_RE = /^brand:[a-z0-9-]{1,40}$/;
const HTTPS_IMG_RE = /^https:\/\/\S+$/;
function validateLink(raw: RawCustomLink, idx: number): ValidCustomLink {
  if (typeof raw.label !== 'string' || raw.label.trim().length === 0) throw new Error(`Link ${idx}: label is required`);
  if (raw.label.trim().length > 50) throw new Error(`Link ${idx}: label too long (max 50)`);
  if (typeof raw.url !== 'string' || !/^https:\/\//.test(raw.url)) throw new Error(`Link ${idx}: url must start with https://`);
  if (raw.url.length > 2000) throw new Error(`Link ${idx}: url too long`);
  if (typeof raw.icon !== 'string' || (!LUCIDE_RE.test(raw.icon) && !BRAND_RE.test(raw.icon) && !HTTPS_IMG_RE.test(raw.icon))) {
    throw new Error(`Link ${idx}: invalid icon`);
  }
  if (raw.position !== 'left' && raw.position !== 'right') throw new Error(`Link ${idx}: position must be left|right`);
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : randomUUID(),
    label: raw.label.trim(),
    url: raw.url,
    icon: raw.icon,
    position: raw.position,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : idx,
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  // === SETUP STATUS ===
  // Returns warnings keyed by admin tab id, true when that tab needs the admin's attention
  // (missing required config). Rendered as red dots in the sidebar on the owning group + tab.
  app.get('/setup-status', async () => {
    const [arrService, qualityMappings, settings] = await Promise.all([
      prisma.service.findFirst({ where: { type: { in: ['radarr', 'sonarr'] }, enabled: true } }),
      prisma.qualityMapping.count(),
      getAppSettings(),
    ]);

    const warnings: Record<string, boolean> = {
      services: !arrService,
      quality: qualityMappings === 0,
      paths: !settings?.defaultMovieFolder || !settings?.defaultTvFolder,
    };

    return { warnings };
  });

  // === SETTINGS ===

  // Single wire shape for GET and PUT /settings: strip the instance apiKey (revealed only via the
  // audited /api-key/reveal path) and return instanceLanguages as a parsed array.
  const toSettingsResponse = (settings: AppSettings) => {
    const { apiKey: _omit, ...safeSettings } = settings;
    return {
      ...safeSettings,
      instanceLanguages: parseInstanceLanguages(settings.instanceLanguages),
    };
  };

  app.get('/settings', async (request, reply) => {
    return toSettingsResponse(await ensureAppSettings());
  });

  app.put('/settings', {
    schema: {
      body: {
        type: 'object',
        properties: {
          defaultQualityProfile: { type: 'number', description: 'Default quality profile ID' },
          defaultMovieFolder: { type: 'string', description: 'Default root folder for movies' },
          defaultTvFolder: { type: 'string', description: 'Default root folder for TV shows' },
          defaultAnimeFolder: { type: 'string', description: 'Default root folder for anime' },
          plexMachineId: { type: 'string', description: 'Plex server machine identifier' },
          notificationMatrix: { type: 'string', description: 'JSON matrix mapping event types to notification channels' },
          autoApproveRequests: { type: 'boolean', description: 'Automatically approve all requests' },
          missingSearchCooldownMin: { type: 'number', description: 'Cooldown in minutes before allowing another missing search' },
          requestsEnabled: { type: 'boolean', description: 'Enable the request system' },
          nsfwBlurEnabled: { type: 'boolean', description: 'Enable NSFW content blur' },
          calendarEnabled: { type: 'boolean', description: 'Enable the calendar feature' },
          siteName: { type: 'string', description: 'Custom site name' },
          siteUrl: { type: 'string', description: 'Public URL of the instance for notification links' },
          instanceLanguages: { type: 'array', items: { type: 'string' }, description: 'Instance languages (ISO 639-1 codes)' },
          disabledLoginMode: { type: 'string', enum: ['block', 'friendly'], description: 'How disabled accounts are rejected at login' },
          arrUserTaggingEnabled: { type: 'boolean', description: 'When true, tag added media in Radarr/Sonarr with oscarr-<username>' },
        },
      },
    },
  }, async (request, reply) => {

    const body = request.body as {
      defaultQualityProfile?: number;
      defaultMovieFolder?: string;
      defaultTvFolder?: string;
      defaultAnimeFolder?: string;
      plexMachineId?: string;
      notificationMatrix?: string;
      autoApproveRequests?: boolean;
      missingSearchCooldownMin?: number;
      requestsEnabled?: boolean;
      nsfwBlurEnabled?: boolean;
      calendarEnabled?: boolean;
      siteName?: string;
      siteUrl?: string;
      instanceLanguages?: string[];
      disabledLoginMode?: 'block' | 'friendly';
      arrUserTaggingEnabled?: boolean;
    };

    const settings = await patchAppSettings({
      defaultQualityProfile: body.defaultQualityProfile ?? undefined,
      defaultMovieFolder: body.defaultMovieFolder ?? undefined,
      defaultTvFolder: body.defaultTvFolder ?? undefined,
      defaultAnimeFolder: body.defaultAnimeFolder ?? undefined,
      plexMachineId: body.plexMachineId ?? undefined,
      notificationMatrix: body.notificationMatrix ?? undefined,
      autoApproveRequests: body.autoApproveRequests ?? undefined,
      missingSearchCooldownMin: body.missingSearchCooldownMin ?? undefined,
      requestsEnabled: body.requestsEnabled ?? undefined,
      nsfwBlurEnabled: body.nsfwBlurEnabled ?? undefined,
      calendarEnabled: body.calendarEnabled ?? undefined,
      siteName: body.siteName ?? undefined,
      siteUrl: body.siteUrl !== undefined ? (body.siteUrl?.trim() || null) : undefined,
      instanceLanguages: body.instanceLanguages ? JSON.stringify(body.instanceLanguages) : undefined,
      disabledLoginMode: body.disabledLoginMode ?? undefined,
      arrUserTaggingEnabled: body.arrUserTaggingEnabled ?? undefined,
    });

    // If instance language changed, clear all caches to force re-fetch in new language.
    // invalidateSiteUrl flushes both the siteUrl AND the instance-language caches in
    // safeNotify — without it, plugin event-bus subscribers keep receiving the old
    // language's titleText/messageText until backend restart.
    if (body.instanceLanguages) {
      invalidateLanguageCache();
      invalidateSiteUrl();
      await prisma.tmdbCache.deleteMany();
      logEvent('info', 'Settings', 'TMDB cache cleared due to language change');
    }

    if (body.siteUrl !== undefined) invalidateSiteUrl();
    logEvent('info', 'Settings', 'Settings updated');
    return toSettingsResponse(settings);
  });

  // === CUSTOM LINKS (#167) ===
  // Admin CRUD for the external links rendered in the home topbar. Public read-side ships via
  // /api/app/features so Layout has them at mount.

  app.get('/custom-links', async () => {
    const settings = await getAppSettings();
    try {
      const parsed = settings?.customLinks ? JSON.parse(settings.customLinks) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  app.put('/custom-links', {
    schema: {
      body: {
        type: 'object',
        required: ['links'],
        properties: {
          links: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              required: ['label', 'url', 'icon', 'position'],
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                url: { type: 'string' },
                icon: { type: 'string' },
                position: { type: 'string', enum: ['left', 'right'] },
                order: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { links: rawLinks } = request.body as { links: RawCustomLink[] };
    let validated: ValidCustomLink[];
    try {
      validated = rawLinks.map((raw, idx) => validateLink(raw, idx));
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    // Re-number `order` based on submission order so the UI doesn't have to manage it strictly.
    validated.forEach((l, i) => { l.order = i; });
    await patchAppSettings({ customLinks: JSON.stringify(validated) });
    logEvent('info', 'Settings', `Custom links updated (${validated.length} link${validated.length === 1 ? '' : 's'})`);
    return { links: validated };
  });

  // === VERBOSE REQUEST LOG (debug toggle) ===
  // Persists every API request to AppLog while ON. Off by default to avoid filling the DB.

  app.get('/verbose-request-log', async () => {
    const s = await getAppSettings();
    return { enabled: s?.verboseRequestLog === true };
  });

  app.put('/verbose-request-log', {
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: { enabled: { type: 'boolean' } },
      },
    },
  }, async (request) => {
    const { enabled } = request.body as { enabled: boolean };
    await patchAppSettings({ verboseRequestLog: enabled });
    const { setVerboseRequestLogFlag } = await import('../../utils/verboseRequestLog.js');
    setVerboseRequestLogFlag(enabled);
    logEvent('warn', 'Settings', `Verbose request log ${enabled ? 'enabled' : 'disabled'}`);
    return { ok: true };
  });

  // === BANNER ===

  app.put('/banner', {
    schema: {
      body: {
        type: 'object',
        properties: {
          banner: { type: ['string', 'null'], description: 'Incident banner message, or null to clear' },
        },
      },
    },
  }, async (request, reply) => {

    const { banner } = request.body as { banner: string | null };
    await patchAppSettings({ incidentBanner: banner || null });
    if (banner) {
      safeNotify('incident_banner', { title: 'Incident', message: banner });
    }
    return { ok: true };
  });

  // ─── API Key management ─────────────────────────────────────────────

  app.get('/api-key', async () => {
    const settings = await getAppSettings();
    if (!settings?.apiKey) return { hasKey: false, maskedKey: null };
    const key = settings.apiKey;
    return { hasKey: true, maskedKey: `${key.slice(0, 8)}${'•'.repeat(24)}${key.slice(-8)}` };
  });

  // Separate endpoint so the plaintext key only travels the wire when the admin explicitly
  // asks for it (Show / Copy), not on every page load. Matches the *arr UX where the key stays
  // retrievable — avoids having to regenerate and re-paste it into every downstream service.
  app.get('/api-key/reveal', async (_request, reply) => {
    const settings = await getAppSettings();
    if (!settings?.apiKey) return reply.code(404).send({ error: 'NO_API_KEY' });
    logEvent('info', 'Settings', 'API key revealed');
    return { apiKey: settings.apiKey };
  });

  app.post('/api-key/generate', async () => {
    const apiKey = crypto.randomBytes(32).toString('hex');
    await patchAppSettings({ apiKey });
    logEvent('info', 'Settings', 'API key generated');
    return { apiKey };
  });

  app.delete('/api-key', async () => {
    await patchAppSettings({ apiKey: null });
    logEvent('info', 'Settings', 'API key revoked');
    return { ok: true };
  });
}
