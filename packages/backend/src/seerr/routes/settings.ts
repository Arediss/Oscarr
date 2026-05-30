import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { getArrClientForService } from '../../providers/index.js';
import { parseServiceConfig } from '../../utils/services.js';
import { logEvent } from '../../utils/logEvent.js';

const ARR_TYPES = ['radarr', 'sonarr'] as const;
type ArrType = typeof ARR_TYPES[number];

function parseArrConfig(raw: string): Record<string, string> {
  // Decrypt via the canonical parser; stay lenient (degrade to {}) but log so an undecryptable row is diagnosable.
  try { return parseServiceConfig(raw); }
  catch (err) { logEvent('warn', 'Seerr', 'parseArrConfig: config parse/decrypt failed', err); return {}; }
}

interface SeerrArrConfig {
  id: number;
  name: string;
  hostname: string;
  port: number;
  useSsl: boolean;
  baseUrl: string;
  /** Always returned empty — Overseerr leaks the API key in this field, we deliberately don't. */
  apiKey: string;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  is4k: boolean;
  minimumAvailability: string;
  isDefault: boolean;
  tagRequests: boolean;
  syncEnabled: boolean;
  preventSearch: boolean;
  tags: number[];
  externalUrl: string;
}

interface ServiceWithRelations {
  id: number;
  name: string;
  isDefault: boolean;
  enabled: boolean;
  config: string;
  qualityMappings: { qualityProfileId: number; qualityProfileName: string }[];
  folderRules: { folderPath: string }[];
}

function buildArrSettingsResponse(service: ServiceWithRelations): SeerrArrConfig {
  const cfg = parseArrConfig(service.config);
  let hostname = '';
  let port = 0;
  let useSsl = false;
  let baseUrl = '';
  try {
    const u = new URL(cfg.url ?? '');
    hostname = u.hostname;
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    useSsl = u.protocol === 'https:';
    baseUrl = u.pathname.replace(/\/+$/, '');
  } catch { /* malformed url — leave defaults so the response stays well-shaped */ }

  // Oscarr decides routing via QualityMapping + FolderRule, not a single "active" pair like
  // Overseerr — we surface the first mapping as a sensible default so Doplarr's UI has a
  // pre-filled value the user can override.
  const firstMapping = service.qualityMappings[0];
  const firstFolder = service.folderRules[0];

  return {
    id: service.id,
    name: service.name,
    hostname,
    port,
    useSsl,
    baseUrl,
    apiKey: '',
    activeProfileId: firstMapping?.qualityProfileId ?? 0,
    activeProfileName: firstMapping?.qualityProfileName ?? '',
    activeDirectory: firstFolder?.folderPath ?? '',
    is4k: false,
    minimumAvailability: 'released',
    isDefault: service.isDefault,
    tagRequests: false,
    syncEnabled: service.enabled,
    preventSearch: false,
    tags: [],
    externalUrl: '',
  };
}

/**
 * `/settings/radarr` and `/settings/sonarr` describe the configured *arr instances so clients
 * (Doplarr in particular) can surface a "pick your server / quality profile / root folder"
 * step before posting a request. We never echo back the real apiKey — Overseerr does, but
 * that's a credential leak we refuse to reproduce.
 *
 * The `/profiles` and `/rootfolders` sub-endpoints fetch live from the *arr instance via
 * Oscarr's existing arr client (so the lists are always current). On failure we return an
 * empty array rather than 500 — Doplarr falls back to its own defaults gracefully.
 */
export async function settingsRoutes(app: FastifyInstance) {
  // Doplarr (and probably others) probe /settings/main for the `partialRequestsEnabled` flag —
  // they fail soft on 501 but log a FATAL stack trace. We return a minimal payload describing
  // the few flags clients actually branch on; everything else stays defaulted to Overseerr-like
  // "off" so we don't accidentally promise a feature Oscarr doesn't deliver.
  app.get('/settings/main', async () => ({
    apiKey: '',
    applicationTitle: 'Oscarr',
    applicationUrl: '',
    csrfProtection: false,
    cacheImages: false,
    defaultPermissions: 32, // REQUEST
    defaultQuotas: { movie: { quotaLimit: 0, quotaDays: 7 }, tv: { quotaLimit: 0, quotaDays: 7 } },
    hideAvailable: false,
    localLogin: true,
    newPlexLogin: false,
    region: '',
    originalLanguage: '',
    trustProxy: true,
    partialRequestsEnabled: true,
    enableSpecialEpisodes: false,
    locale: 'en',
    discoverRegion: '',
    streamingRegion: 'US',
    youtubeUrl: '',
  }));

  for (const arrType of ARR_TYPES) {
    app.get(`/settings/${arrType}`, async () => {
      const services = await prisma.service.findMany({
        where: { type: arrType },
        include: { folderRules: true, qualityMappings: true },
      });
      return services.map(buildArrSettingsResponse);
    });

    app.get<{ Params: { id: string } }>(
      `/settings/${arrType}/:id/profiles`,
      async (request, reply) => loadArrSubResource(request.params.id, arrType, reply, async (service, type) => {
        const cfg = parseArrConfig(service.config);
        const client = getArrClientForService(service.id, type, cfg);
        const profiles = await client.getQualityProfiles();
        return profiles.map((p) => ({ id: p.id, name: p.name }));
      }),
    );

    app.get<{ Params: { id: string } }>(
      `/settings/${arrType}/:id/rootfolders`,
      async (request, reply) => loadArrSubResource(request.params.id, arrType, reply, async (service, type) => {
        const cfg = parseArrConfig(service.config);
        const client = getArrClientForService(service.id, type, cfg);
        const folders = await client.getRootFolders();
        return folders.map((f) => ({ id: f.id, path: f.path, freeSpace: f.freeSpace }));
      }),
    );
  }
}

async function loadArrSubResource<T>(
  rawId: string,
  expectedType: ArrType,
  reply: import('fastify').FastifyReply,
  fetcher: (service: { id: number; config: string }, type: ArrType) => Promise<T>,
): Promise<T | unknown[]> {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service || service.type !== expectedType) return reply.status(404).send({ error: 'NOT_FOUND' });
  try {
    return await fetcher(service, expectedType);
  } catch (err) {
    reply.log.warn({ err }, `[seerr] failed to fetch ${expectedType} sub-resource for service ${id}`);
    return [];
  }
}
