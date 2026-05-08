import type { FastifyInstance } from 'fastify';

// ─── Arr Client Shared Types ────────────────────────────────────────

export interface ArrTag { id: number; label: string }
export interface ArrQualityProfile { id: number; name: string }
export interface ArrRootFolder { id: number; path: string; freeSpace: number }

// ─── Normalized types for business logic ────────────────────────────

export interface ArrMediaItem {
  serviceMediaId: number;
  externalId: number;
  /** TMDB id when the upstream provider exposes it (Sonarr v3 ships it on each series).
   *  Lets the sync write the real `tmdbId` on TV rows instead of the negative `-tvdbId`
   *  placeholder, so home-page batch-status queries (which key by positive tmdbId) match. */
  tmdbId?: number;
  title: string;
  status: string;
  posterPath: string | null;
  backdropPath: string | null;
  qualityProfileId: number;
  addedDate: string | null;
  tags: number[];
  hasFile: boolean;
  seasons?: ArrSeasonItem[];
}

export interface ArrSeasonItem {
  seasonNumber: number;
  monitored: boolean;
  episodeFileCount: number;
  totalEpisodeCount: number;
  percentComplete: number;
  status: string;
}

export interface ArrAvailabilityResult {
  available: boolean;
  audioLanguages: string[] | null;
  subtitleLanguages: string[] | null;
  seasonStats?: { seasonNumber: number; episodeFileCount: number; episodeCount: number; totalEpisodeCount: number }[];
}

export interface ArrHistoryEntry {
  serviceMediaId: number;
  date: Date;
  extraData?: Record<string, unknown>;
}

export interface ArrEpisode {
  episodeNumber: number;
  title: string;
  airDateUtc: string | null;
  hasFile: boolean;
  monitored: boolean;
  quality: string | null;
  size: number | null;
}

export interface ArrWebhookEvent {
  type: 'download' | 'grab' | 'added' | 'deleted' | 'test' | 'unknown';
  externalId: number;
  /** *arr-internal id for the movie/series (Radarr's `movie.id`, Sonarr's `series.id`).
   *  Persisted on the matching Media row as `radarrId` / `sonarrId` — the home's
   *  "Recently added" query filters on those, so without it a webhook-only flow (admin
   *  disables the sync job) leaves freshly-available media invisible on the home. */
  internalId?: number;
  title: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface ArrAddMediaOptions {
  title: string;
  externalId: number;
  qualityProfileId: number;
  rootFolderPath: string;
  tags: number[];
  seasons?: number[];
  seriesType?: string;
}

export interface ArrClient {
  getTags(): Promise<ArrTag[]>;
  createTag(label: string): Promise<ArrTag>;
  getOrCreateTag(username: string): Promise<number>;
  getQualityProfiles(): Promise<ArrQualityProfile[]>;
  getRootFolders(): Promise<ArrRootFolder[]>;
  getSystemStatus(): Promise<{ version: string }>;
  getQueue(): Promise<{ records: unknown[] }>;
  getHistory(since?: Date | null): Promise<unknown[]>;
  getCalendar(start: string, end: string): Promise<unknown[]>;

  // Sync
  getAllMedia(): Promise<ArrMediaItem[]>;

  /** Fetch a single media row by its *arr internal id (Radarr movie.id / Sonarr series.id).
   *  Returns the same shape as `getAllMedia()` items so webhooks can enrich a freshly-added
   *  row with poster / quality / seasons without scanning the whole library. Null when the
   *  service returns 404 (already deleted, etc.). */
  getMediaById(serviceMediaId: number): Promise<ArrMediaItem | null>;

  // Live check
  checkAvailability(externalId: number): Promise<ArrAvailabilityResult>;

  // Request dispatch
  findByExternalId(externalId: number): Promise<{ id: number } | null>;
  addMedia(options: ArrAddMediaOptions): Promise<void>;
  searchMedia(serviceMediaId: number): Promise<void>;
  deleteMedia(serviceMediaId: number, deleteFiles?: boolean): Promise<void>;

  // Normalized history
  getHistoryEntries(since?: Date | null): Promise<ArrHistoryEntry[]>;

  // Episodes (TV only — optional, not implemented by movie providers)
  getEpisodesNormalized?(serviceMediaId: number, seasonNumber?: number): Promise<ArrEpisode[]>;

  // Webhooks
  parseWebhookPayload?(body: unknown): ArrWebhookEvent | null;
  registerWebhook?(name: string, url: string, apiKey: string): Promise<number>;
  removeWebhook?(webhookId: number): Promise<void>;
  checkWebhookExists?(webhookId: number): Promise<boolean>;
  getWebhookEvents?(): { key: string; label: string; description: string }[];

  // Metadata
  readonly mediaType: 'movie' | 'tv';
  readonly serviceType: string;
  readonly dbIdField: 'radarrId' | 'sonarrId';
  readonly defaultRootFolder: string;
}

// ─── Shared image extraction utility ────────────────────────────────

export function extractImageFromArr(images: { coverType: string; remoteUrl: string }[] | undefined, type: 'poster' | 'fanart'): string | null {
  const url = images?.find(i => i.coverType === type)?.remoteUrl;
  if (!url) return null;
  const match = /\/t\/p\/\w+(\/.+?)(?:\?|$)/.exec(url);
  if (match) return match[1];
  // For non-TMDB URLs (TVDB etc.), store the full URL
  if (url.startsWith('http')) return url;
  return null;
}

// ─── Service Definition ─────────────────────────────────────────────

export interface ServiceField {
  key: string;
  labelKey: string; // i18n key — translated by the frontend
  type: 'text' | 'password';
  placeholder?: string;
  helper?: string; // e.g. 'plex-oauth', 'plex-detect-machine-id'
}

export interface ServiceDefinition {
  id: string;
  label: string;
  icon: string; // URL to provider icon
  category: 'arr' | 'media-server' | 'download-client' | 'indexer' | 'monitoring';
  fields: ServiceField[];
  /** Media types this service handles (e.g. radarr=['movie'], sonarr=['tv'], a future
   *  lidarr=['music']). Used by `getServiceTypeForMedia(mediaType)` without a hardcoded
   *  lookup. Services that don't participate in media routing (plex, tautulli) omit this. */
  handlesMediaTypes?: readonly string[];
  /** True until this connector has been validated against a real instance by the maintainer.
   *  Surfaces an "Untested" pill in the picker and a feedback banner once selected, so users
   *  know to report back. Removed in the same commit that confirms the integration works. */
  untested?: boolean;
  test(config: Record<string, string>): Promise<{ ok: boolean; version?: string }>;
  createClient?(config: Record<string, string>): ArrClient;
}

// ─── Auth Provider ──────────────────────────────────────────────────

export interface AuthProviderField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'url' | 'boolean';
  required?: boolean;
  placeholder?: string;
  /** Optional human-readable help text shown under the input. */
  help?: string;
  /** Default value (used by the UI when no value is set yet; not persisted on its own). */
  default?: string | boolean;
}

export interface AuthProviderConfig {
  id: string;
  label: string;
  type: 'oauth' | 'credentials';
  /** Fields the admin must configure (e.g. OAuth clientId/secret). Empty or missing = no admin config. */
  configSchema?: AuthProviderField[];
  /** When true, the matching `Service` row (by `type === id`) must exist AND be enabled for this
   *  auth provider to surface at all — both in the admin Authentication tab and the public login
   *  page. Use for providers that rely on an admin-configured server URL (jellyfin, emby).
   *  Leave undefined for federated/self-contained providers (plex.tv, Discord OAuth, email). */
  requiresService?: boolean;
}

export interface AuthHelpers {
  signAndSend: (reply: import('fastify').FastifyReply, userId: number) => Promise<void>;
  findOrCreateUser: (opts: {
    provider: string;
    providerId: string;
    providerToken?: string;
    providerUsername?: string;
    providerEmail?: string;
    email: string;
    displayName: string;
    /** Avatar URL fetched from this provider. Stored on `UserProvider.providerAvatar` and
     *  potentially picked up by `User.avatar` depending on the user's `avatarSource` setting. */
    avatar?: string | null;
  }) => Promise<{
    id: number;
    email: string;
    displayName: string | null;
    avatar: string | null;
    role: string;
    providers: { provider: string; providerUsername: string | null; providerEmail: string | null }[];
    isNew: boolean;
  }>;
}

export interface SyncPendingImport {
  providerId: string;
  providerUsername?: string | null;
  providerEmail?: string | null;
}

export interface SyncResult {
  enabled: number;    // users re-enabled because they're back on the provider
  disabled: number;   // users disabled because they're no longer on the provider
  pendingImports: SyncPendingImport[]; // provider users with no matching Oscarr account
}

export interface AuthProvider {
  config: AuthProviderConfig;
  registerRoutes(app: FastifyInstance, helpers: AuthHelpers): Promise<void>;
  linkAccount?(pinId: number, userId: number): Promise<{ providerUsername: string }>;
  linkAccountByCredentials?(username: string, password: string, userId: number): Promise<{ providerUsername: string }>;
  /** Pull users from the provider into Oscarr. When `filter.providerIds` is set, only users
   *  whose provider-side id is in the list are imported — lets the admin cherry-pick from a
   *  sync-surfaced pendingImports list instead of importing everyone on the server. */
  importUsers?(
    adminUserId: number,
    filter?: { providerIds?: string[] },
  ): Promise<{ imported: number; skipped: number; total: number }>;
  /** Reconcile local Oscarr users with the provider's authoritative list. Disables users who aren't on the provider anymore, re-enables returning ones, and reports unmatched provider entries for admin-confirmed import. */
  syncUsers?(adminUserId: number): Promise<SyncResult>;
  getToken?(adminUserId: number): Promise<string | null>;
}

// ─── Unified Provider ───────────────────────────────────────────────
// Every provider has at least one of `service` (it's a media/downloader server) or
// `auth` (it's a login source). Service-only = radarr/sonarr/qbittorrent; auth-only =
// email/discord; both = plex/jellyfin/emby (the media server IS also the login source).

export interface Provider {
  service?: ServiceDefinition;
  auth?: AuthProvider;
}
