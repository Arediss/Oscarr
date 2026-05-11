import type { FastifyBaseLogger } from 'fastify';
import type { NotificationRegistry } from '../notifications/registry.js';
import type { NotificationPayload } from '../notifications/types.js';
import type { ArrClient } from '../providers/types.js';
import type { PluginRouter } from './router.js';
import type { PluginMedia, PluginMediaRequest, PluginMediaBatchKey, PluginMediaBatchStatus, PluginTmdbSearchPage, PluginFolderRule, TmdbMovie, TmdbTv, PluginSettingDef } from '@oscarr/shared';
import type { Migration, PluginDatabase } from './storage/index.js';

export type { Migration, PluginDatabase };

// ─── Plugin Manifest (manifest.json) ────────────────────────────────

export type PluginCapability =
  | 'users:read'
  | 'users:write'
  | 'settings:plugin'
  | 'settings:app'
  | 'notifications'
  | 'permissions'
  | 'events'
  // Added in v1.1 — scoped access to read/write the request pipeline + TMDB metadata.
  // Each new bucket is opt-in via manifest.capabilities, checked at call-time in context/v1.ts.
  | 'tmdb:read'
  | 'requests:read'
  | 'requests:write'
  // Persistent plugin-owned storage (JSON KV + SQLite) under data/plugins/<id>/. Files are
  // wiped on uninstall; never touches oscarr.db.
  | 'storage:plugin';

export const ALL_CAPABILITIES: readonly PluginCapability[] = [
  'users:read',
  'users:write',
  'settings:plugin',
  'settings:app',
  'notifications',
  'permissions',
  'events',
  'tmdb:read',
  'requests:read',
  'requests:write',
  'storage:plugin',
] as const;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 'v1';
  description?: string;
  author?: string;
  entry: string;
  frontend?: string;
  /** Compatibility declaration. `oscarr` is a semver range the author claims to support;
   *  `testedAgainst` lists Oscarr versions explicitly verified to work. Missing = 'unknown' status. */
  engines?: {
    oscarr: string;
    testedAgainst?: string[];
  };
  /** Services whose config the plugin is allowed to read via getServiceConfig / getServiceConfigRaw.
   *  Any service not listed here returns null and is logged. Empty / missing = no service access. */
  services?: string[];
  /** Capability buckets the plugin requests. Any ctx method outside the declared buckets throws at call
   *  time. `log` and `services:*` are gated separately (log = always granted, services = via `services`). */
  capabilities?: PluginCapability[];
  /** Optional per-capability justification shown in the admin consent prompt on enable. */
  capabilityReasons?: Partial<Record<PluginCapability, string>>;
  settings?: PluginSettingDef[];
  hooks?: {
    routes?: { prefix: string };
    jobs?: PluginJobDef[];
    ui?: UIContribution[];
    features?: Record<string, boolean>;
  };
}

// PluginSettingDef moved to @oscarr/shared (shared wire contract with the frontend).
export type { PluginSettingDef } from '@oscarr/shared';

export interface PluginJobDef {
  key: string;
  label: string;
  cron: string;
}

export interface UIContribution {
  hookPoint: string;
  props: Record<string, unknown>;
  order?: number;
}

/** UIContribution enriched with the owning plugin's id (returned by engine) */
export interface LoadedUIContribution extends UIContribution {
  pluginId: string;
}

// ─── Plugin Context (V1 API passed to plugins) ──────────────────────

export interface PluginContext {
  log: FastifyBaseLogger;
  getUser(userId: number): Promise<{ id: number; email: string; displayName: string | null; role: string; avatar: string | null } | null>;
  /** Assign a role to a user. Throws if the role doesn't exist. */
  setUserRole(userId: number, roleName: string): Promise<void>;
  /** Enable or disable an Oscarr user. Disabled users are rejected at login per AppSettings.disabledLoginMode (friendly message vs silent block). Admins cannot be disabled via this method — throws if you try, to protect the server owner from accidental lockout. */
  setUserDisabled(userId: number, disabled: boolean): Promise<void>;
  /** Mint an auth JWT for the given user. Caller is responsible for delivering it (cookie, response body, etc.). */
  issueAuthToken(userId: number): Promise<string>;
  /** Returns the plugin's dedicated data folder (creates it if missing). Absolute path under {backendRoot}/data/plugins/{pluginId}/. */
  getPluginDataDir(): Promise<string>;
  getAppSettings(): Promise<Record<string, unknown>>;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  sendNotification(type: string, data: NotificationPayload): Promise<void>;
  sendUserNotification(userId: number, payload: { type: string; title: string; message: string; metadata?: Record<string, unknown> }): Promise<void>;
  getArrClient(serviceType: string): Promise<ArrClient>;
  getServiceConfig(serviceType: string): Promise<{ url: string; apiKey: string } | null>;
  /** Returns the full raw JSON config of a configured service (whatever fields the provider chose to store). Use when you need more than the common url/apiKey subset. */
  getServiceConfigRaw(serviceType: string): Promise<Record<string, unknown> | null>;
  /** Returns the external auth providers linked to an Oscarr user (identity info only — no tokens). */
  getUserProviders(userId: number): Promise<Array<{ provider: string; providerId: string | null; providerUsername: string | null; providerEmail: string | null }>>;
  /**
   * Find the Oscarr user linked to a given external provider identity. Returns null if no
   * UserProvider row matches. Useful for plugins that receive events from external systems
   * (Discord bot webhooks, etc.) and need to resolve the Oscarr user behind an external ID.
   */
  findUserByProvider(provider: string, providerId: string): Promise<{ id: number; email: string; displayName: string | null; role: string; avatar: string | null } | null>;
  registerRoutePermission(routeKey: string, rule: { permission: string; ownerScoped?: boolean }): void;
  registerPluginPermission(permission: string, description?: string): void;
  events: {
    on(event: string, handler: (data: unknown) => void | Promise<void>): void;
    off(event: string, handler: (data: unknown) => void | Promise<void>): void;
    emit(event: string, data: unknown): Promise<void>;
  };

  /** Plugin-owned persistent storage. Files live under `data/plugins/<pluginId>/` and are
   *  wiped on uninstall — they never touch oscarr.db. Gated by `storage:plugin`. */
  kv: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
  db: {
    /** Open or reuse a cached SQLite handle. `name` becomes `<name>.db` in the plugin's
     *  data dir, restricted to `[a-zA-Z0-9_-]+` to block path traversal. Pass `migrations`
     *  to apply them in the same call — equivalent to calling `migrate()` afterwards. */
    open(name: string, migrations?: Migration[]): Promise<PluginDatabase>;
    /** Apply migrations whose version is > the current `_schema_version`, in ascending
     *  order, each in its own transaction. Idempotent on re-run. Not safe to call
     *  concurrently on the same handle. */
    migrate(db: PluginDatabase, migrations: Migration[]): Promise<void>;
  };

  // ─── v1.1 additions (additive — existing plugins keep working unchanged) ───

  /** Pluriel form of `getArrClient`: returns every enabled instance of the given service type
   *  (e.g. two Radarrs). Use this when a plugin needs to fan out across multi-instance setups
   *  instead of always targeting the default one. Gated by the existing `services[]` ACL —
   *  the plugin must declare the service type in its manifest. */
  getArrClients(serviceType: string): Promise<ArrClient[]>;

  /** Find an Oscarr user by email. Symmetric to `findUserByProvider`. Useful for CSV imports,
   *  cross-system reconciliation, or webhook payloads that only carry an email. */
  findUserByEmail(email: string): Promise<{ id: number; email: string; displayName: string | null; role: string; avatar: string | null } | null>;

  /** Read-only enumeration of the admin's routing rules. Plugins typically use this to offer
   *  the same category picker as the web UI (Radarr "Movies / 4K / Anime" buckets). Optional
   *  `enabled` filter matches the admin UI's default view. */
  listFolderRules(options?: { enabled?: boolean }): Promise<PluginFolderRule[]>;

  /** TMDB metadata bucket — wraps `services/tmdb.ts` with cache + lang-resolution respected.
   *  Gated by `tmdb:read`. `lang` falls back to the instance default when omitted. */
  tmdb: {
    search(query: string, options?: { page?: number; lang?: string }): Promise<PluginTmdbSearchPage>;
    movie(tmdbId: number, options?: { lang?: string }): Promise<TmdbMovie>;
    tv(tmdbId: number, options?: { lang?: string }): Promise<TmdbTv>;
  };

  /** Oscarr-side media helpers. Kept separate from `requests` because `batchStatus` + `getById`
   *  are read-only and useful on their own (enriching a TMDB result grid, rendering a
   *  notification payload). Gated by `requests:read` — same bucket since both query the same
   *  request-aware view of the library. */
  media: {
    /** Bulk lookup of Oscarr status for N TMDB ids. When `userId` is passed, also reports the
     *  user's personal request status per item. Replaces N+1 patterns where a plugin would
     *  otherwise loop `findByExternalId` per result. */
    batchStatus(
      items: Array<{ tmdbId: number; mediaType: 'movie' | 'tv' }>,
      userId?: number,
    ): Promise<Record<PluginMediaBatchKey, PluginMediaBatchStatus>>;
    /** Single-media lookup by Oscarr id (not TMDB id). Returns null when the media row
     *  doesn't exist — plugins can enrich a notification payload or confirm a reference. */
    getById(mediaId: number): Promise<PluginMedia | null>;
  };

  /** Escape hatch for calling the host's own HTTP API. Useful for endpoints that don't have
   *  a typed ctx wrapper yet (e.g. plugin-specific admin surfaces, legacy routes). The engine
   *  resolves `localhost:${PORT}` and — when `asUserId` is passed — mints a short-lived auth
   *  cookie scoped to that user so the call passes RBAC as if the user made it themselves.
   *  No capability bucket: internalFetch is always available, but the target route's own RBAC
   *  rules still apply (hitting an admin route without `asUserId` pointing to an admin
   *  returns 401/403). */
  app: {
    internalFetch(
      path: string,
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
        /** When set, the call is authenticated as this user (same session a browser would
         *  get by logging in). Omitted → call runs unauthenticated, only reaches public
         *  routes like `/api/app/features`. */
        asUserId?: number;
      },
    ): Promise<Response>;
  };

  /** Request pipeline access. Read methods gated by `requests:read`; `create` gated by
   *  `requests:write`. */
  requests: {
    /** List the given user's requests. Useful for a "your pending requests" Discord command
     *  or a queue-visualiser plugin. Optional `status` narrows to a specific status code.
     *  `limit` caps the response (default 50, hard max 200) — pagination is intentionally
     *  not exposed; plugins that need deeper slices should filter by `status` instead. */
    listForUser(
      userId: number,
      options?: { limit?: number; status?: string },
    ): Promise<PluginMediaRequest[]>;
    /** Run the full create-request pipeline on behalf of `userId`: validation → pluginGuard
     *  (skippable via `skipPluginGuard` for guard-owning plugins) → blacklist → dedup →
     *  quality gate → row create → sendToService → safeNotify. No role escalation — the
     *  pipeline loads the target user's role from the DB and behaves exactly as the HTTP
     *  route would for that same user. */
    create(input: {
      userId: number;
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      seasons?: number[];
      rootFolder?: string;
      qualityOptionId?: number;
      skipPluginGuard?: boolean;
    }): Promise<
      | { ok: true; requestId: number; status: string; autoApproved: boolean; sendFailed?: boolean }
      | { ok: false; code: string; error: string }
    >;
  };
}

// ─── Plugin Registration (what register() returns) ──────────────────

/** Guard result — return null to allow, or an error to block */
export interface PluginGuardResult {
  blocked: true;
  error: string;
  statusCode?: number;
}

/** Optional context passed to guards. Lets a guard inspect what the user is trying to do
 *  (e.g. how many TV seasons a quotas plugin should count) instead of relying solely on
 *  past state. Guards remain free to ignore it — older guards keep working unchanged. */
export interface PluginGuardContext {
  request?: {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    seasons?: number[] | null;
  };
}

export interface PluginRegistration {
  manifest: PluginManifest;
  registerRoutes?(app: PluginRouter, ctx: PluginContext): Promise<void>;
  registerJobs?(ctx: PluginContext): Record<string, () => Promise<unknown>>;
  registerGuards?(ctx: PluginContext): Record<string, (userId: number, context?: PluginGuardContext) => Promise<PluginGuardResult | null>>;
  registerNotificationProviders?(registry: NotificationRegistry): void;
  onInstall?(ctx: PluginContext): Promise<void>;
  onEnable?(ctx: PluginContext): Promise<void>;
  onDisable?(ctx: PluginContext): Promise<void>;
}

// ─── Internal types ─────────────────────────────────────────────────

export interface LoadedPlugin {
  manifest: PluginManifest;
  registration: PluginRegistration;
  dir: string;
  enabled: boolean;
  error?: string;
  /** True when `plugins/<dir>/` is a symlink (dev workflow). Resolved at boot via lstat. */
  isSymlink?: boolean;
}

// ─── Plugin source / runtime status ─────────────────────────────────

/** How a plugin was installed.
 *  - 'registry': installed via /install with a `repository` body — eligible for in-app
 *                updates and (eventually) auto-update.
 *  - 'local':    everything else (symlink dev install, install from a raw URL, manual
 *                drop-in, or any plugin whose state predates this flow). The admin manages
 *                updates themselves. */
export type PluginSource = 'registry' | 'local';

/** Runtime status returned by GET /api/plugins. Drives the admin UI badges. */
export interface PluginRuntimeStatus {
  source: PluginSource;
  isSymlink: boolean;
  installedVersion: string;
  /** Latest registry-published version. Null for 'local' plugins (we don't track them). */
  latestVersion: string | null;
  /** True iff source === 'registry' AND latestVersion > installedVersion. */
  updateAvailable: boolean;
  autoUpdateEnabled: boolean;
}

// PluginInfo (the public shape returned by getPluginList()) moved to @oscarr/shared.
export type { PluginInfo } from '@oscarr/shared';
