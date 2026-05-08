import { plexProvider } from './plex/index.js';
import { jellyfinProvider } from './jellyfin/index.js';
import { embyProvider } from './emby/index.js';
import { radarrProvider } from './radarr/index.js';
import { sonarrProvider } from './sonarr/index.js';
import { qbittorrentProvider } from './qbittorrent/index.js';
import { jackettProvider } from './jackett/index.js';
import { prowlarrProvider } from './prowlarr/index.js';
import { nzbgetProvider } from './nzbget/index.js';
import { sabnzbdProvider } from './sabnzbd/index.js';
import { transmissionProvider } from './transmission/index.js';
import { delugeProvider } from './deluge/index.js';
import { tautulliProvider } from './tautulli/index.js';
import { emailProvider } from './email/index.js';
import { discordProvider } from './discord/index.js';
import type { Provider, ServiceDefinition, AuthProvider, ArrClient } from './types.js';
import { getServiceConfig } from '../utils/services.js';
import { getProviderSettings, listAllProviderSettings } from './authSettings.js';

// ─── Provider Registry ──────────────────────────────────────────────
// Add new providers here — they auto-register everywhere. A provider may expose `service`,
// `auth`, or both. Auth-only providers (email, discord) have no `service` field and are
// naturally filtered out of the Services admin tab by `p.service` presence checks.
const ALL_PROVIDERS: Provider[] = [
  radarrProvider,
  sonarrProvider,
  plexProvider,
  jellyfinProvider,
  embyProvider,
  qbittorrentProvider,
  transmissionProvider,
  delugeProvider,
  nzbgetProvider,
  sabnzbdProvider,
  jackettProvider,
  prowlarrProvider,
  tautulliProvider,
  emailProvider,
  discordProvider,
];

// ─── Service queries ────────────────────────────────────────────────

export function getServiceDefinition(type: string): ServiceDefinition | undefined {
  return ALL_PROVIDERS.find((p) => p.service?.id === type)?.service;
}

function hasService(p: Provider): p is Provider & { service: ServiceDefinition } {
  return p.service !== undefined;
}

export function getAllServiceDefinitions(): ServiceDefinition[] {
  return ALL_PROVIDERS.filter(hasService).map((p) => p.service);
}

/** Return schemas for the frontend (fields, icon, label — no test function) */
export function getServiceSchemas() {
  return ALL_PROVIDERS.filter(hasService).map((p) => ({
    id: p.service.id,
    label: p.service.label,
    icon: p.service.icon,
    category: p.service.category,
    fields: p.service.fields,
  }));
}

// ─── Auth queries ───────────────────────────────────────────────────

export function getAuthProviders(): AuthProvider[] {
  return ALL_PROVIDERS.filter((p) => p.auth).map((p) => p.auth!);
}

export function getAuthProvider(id: string): AuthProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.auth?.config.id === id)?.auth;
}

export async function getAuthProviderConfigs() {
  // Enablement now lives in AuthProviderSettings — decoupled from the Service table so
  // auth-only providers (email, discord, …) and media-service providers (plex, jellyfin, emby)
  // can be toggled independently. Providers declaring `requiresService` (jellyfin, emby) are
  // additionally filtered out when their matching Service row is missing or disabled, so the
  // login page never offers a button that would 503 on click.
  const authProviders = getAuthProviders();
  // Ensure every declared auth provider has a settings row — upsert-on-read defends against
  // the race where two concurrent calls both miss the row and both try to create it.
  await Promise.all(authProviders.map((p) => getProviderSettings(p.config.id)));
  const settings = await listAllProviderSettings();
  const settingsById = new Map(settings.map((s) => [s.provider, s]));
  const enabledIds = new Set(settings.filter((s) => s.enabled).map((s) => s.provider));
  const { prisma } = await import('../utils/prisma.js');
  const services = await prisma.service.findMany({ select: { type: true, enabled: true } });
  const serviceEnabledByType = new Map(services.map((s) => [s.type, s.enabled]));
  return getAuthProviders()
    .filter((p) => {
      if (!enabledIds.has(p.config.id)) return false;
      if (p.config.requiresService && serviceEnabledByType.get(p.config.id) !== true) return false;
      return true;
    })
    .map((p) => ({
      ...p.config,
      // Expose allowSignup so the login page can hide the "Create account" UI when email's
      // signup is off, and so OAuth buttons can optionally signal "existing users only".
      allowSignup: settingsById.get(p.config.id)?.config.allowSignup === true,
    }));
}

// ─── Arr Client Factory & Caching ───────────────────────────────────

const _defaultCache = new Map<string, { instance: ArrClient; configKey: string }>();
const _serviceCache = new Map<number, { instance: ArrClient; configKey: string }>();

export async function getArrClient(type: string): Promise<ArrClient> {
  const config = await getServiceConfig(type);
  if (!config?.url || !config?.apiKey) throw new Error(`No ${type} service configured`);
  const configKey = `${config.url}|${config.apiKey}`;
  const cached = _defaultCache.get(type);
  if (cached?.configKey === configKey) return cached.instance;
  const def = getServiceDefinition(type);
  if (!def?.createClient) throw new Error(`Provider "${type}" does not support client creation`);
  const instance = def.createClient(config);
  _defaultCache.set(type, { instance, configKey });
  return instance;
}

export function getArrClientForService(serviceId: number, serviceType: string, config: Record<string, string>): ArrClient {
  const configKey = `${config.url}|${config.apiKey}`;
  const cached = _serviceCache.get(serviceId);
  if (cached?.configKey === configKey) return cached.instance;
  const def = getServiceDefinition(serviceType);
  if (!def?.createClient) throw new Error(`Provider "${serviceType}" does not support client creation`);
  const instance = def.createClient(config);
  _serviceCache.set(serviceId, { instance, configKey });
  return instance;
}

export function createArrClient(type: string, config: Record<string, string>): ArrClient {
  const def = getServiceDefinition(type);
  if (!def?.createClient) throw new Error(`Provider "${type}" does not support client creation`);
  return def.createClient(config);
}

/** Resolves which service type owns a given media type (e.g. `movie` → `radarr`) by scanning
 *  `ALL_PROVIDERS` for the first service whose `handlesMediaTypes` includes the requested
 *  value. New providers (e.g. lidarr for music) just declare the field on their ServiceDefinition
 *  — no hardcoded lookup to patch. */
export function getServiceTypeForMedia(mediaType: string): string {
  for (const provider of ALL_PROVIDERS) {
    if (provider.service?.handlesMediaTypes?.includes(mediaType)) {
      return provider.service.id;
    }
  }
  throw new Error(`No service type for media type "${mediaType}"`);
}

// Re-export types
export type { Provider, ServiceDefinition, AuthProvider, AuthHelpers, AuthProviderConfig, ServiceField, ArrClient, ArrMediaItem, ArrAvailabilityResult, ArrHistoryEntry, ArrAddMediaOptions, ArrSeasonItem } from './types.js';
export { extractImageFromArr } from './types.js';
