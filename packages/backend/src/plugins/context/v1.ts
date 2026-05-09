import type { FastifyBaseLogger } from 'fastify';
import { pluginEventBus } from '../eventBus.js';
import { prisma } from '../../utils/prisma.js';
import { getPluginDataDir } from '../../utils/dataPath.js';
import { getKV, openPluginDb, migrate as migrateDb, type PluginDatabase, type Migration } from '../storage/index.js';
import { scrubSecrets } from '../../utils/logScrubber.js';
import { notificationRegistry } from '../../notifications/index.js';
import type { NotificationPayload } from '../../notifications/types.js';
import { sendUserNotification } from '../../services/userNotifications.js';
import { getArrClient, createArrClient } from '../../providers/index.js';
import { getAllServices, parseServiceConfig } from '../../utils/services.js';
import type { ArrClient } from '../../providers/types.js';
import { searchMulti, getMovieDetails, getTvDetails } from '../../services/tmdb.js';
import { createUserRequest } from '../../services/requestService.js';
import type {
  PluginTmdbSearchPage,
  PluginMedia,
  PluginMediaRequest,
  PluginMediaBatchKey,
  PluginMediaBatchStatus,
  PluginFolderRule,
} from '@oscarr/shared';
import { ACTIVE_REQUEST_STATUSES } from '@oscarr/shared';
import {
  registerRoutePermission as rbacRegisterRoute,
  registerPluginPermission as rbacRegisterPermission,
} from '../../middleware/rbac.js';
import type { PluginCapability, PluginContext, PluginManifest } from '../types.js';

/**
 * Dependencies injected by the engine so the factory stays decoupled
 * from PluginEngine internals.
 */
export interface V1FactoryDeps {
  logger: FastifyBaseLogger | null;
  getCachedSettings(pluginId: string): Promise<Record<string, unknown>>;
  setSettingsCache(pluginId: string, values: Record<string, unknown>): void;
  makeFallbackLogger(pluginId: string): FastifyBaseLogger;
  /** Signs a JWT payload using the app's JWT secret. Available only after the engine is registered with Fastify. */
  signAuthToken(payload: { id: number; email: string; role: string }): string;
}

// Rate-limit plugin log persistence per pluginId so a misbehaving plugin in a loop can't flood
// PluginLog (exhaust disk / slow down the admin UI). The structured log via the parent Pino
// child still fires — only the DB write is throttled.
const LOG_RATE_WINDOW_MS = 10_000;
const LOG_RATE_MAX = 100;
const logRateCounters = new Map<string, { count: number; windowStart: number; droppedSinceSummary: number }>();

export function clearLogRateCounter(pluginId: string): void {
  logRateCounters.delete(pluginId);
}

function shouldPersistLog(pluginId: string): boolean {
  const now = Date.now();
  let c = logRateCounters.get(pluginId);
  if (!c || now - c.windowStart > LOG_RATE_WINDOW_MS) {
    c = { count: 0, windowStart: now, droppedSinceSummary: 0 };
    logRateCounters.set(pluginId, c);
  }
  if (c.count < LOG_RATE_MAX) {
    c.count++;
    return true;
  }
  c.droppedSinceSummary++;
  // On first overflow of the window, write one summary line so the admin sees what happened.
  if (c.droppedSinceSummary === 1) {
    prisma.pluginLog.create({
      data: {
        pluginId,
        level: 'warn',
        message: `[rate-limited] exceeded ${LOG_RATE_MAX} log lines in ${LOG_RATE_WINDOW_MS / 1000}s — further logs in this window are dropped`,
      },
    }).catch(() => {});
  }
  return false;
}

function createCapturingLogger(
  baseLogger: FastifyBaseLogger,
  pluginId: string
): FastifyBaseLogger {
  const child = baseLogger.child({ plugin: pluginId });

  const capture = (level: string, msg: string) => {
    if (!shouldPersistLog(pluginId)) return;
    // Scrub secrets before persistence — PluginLog is exposed in the admin UI,
    // so a careless `ctx.log.info(config)` must not leak tokens/keys there.
    const scrubbed = scrubSecrets(String(msg)).slice(0, 2000);
    prisma.pluginLog.create({
      data: { pluginId, level, message: scrubbed },
    }).catch(() => {}); // Fire-and-forget
  };

  // Wrap log methods — use function() + apply() to preserve Pino's overloaded signatures
  const origInfo = child.info;
  const origWarn = child.warn;
  const origError = child.error;

  child.info = function (this: any, ...args: any[]) {
    capture('info', typeof args[0] === 'string' ? args[0] : args[1] || '');
    return origInfo.apply(this, args as any);
  } as typeof child.info;
  child.warn = function (this: any, ...args: any[]) {
    capture('warn', typeof args[0] === 'string' ? args[0] : args[1] || '');
    return origWarn.apply(this, args as any);
  } as typeof child.warn;
  child.error = function (this: any, ...args: any[]) {
    capture('error', typeof args[0] === 'string' ? args[0] : args[1] || '');
    return origError.apply(this, args as any);
  } as typeof child.error;

  return child;
}

/**
 * Frozen V1 context factory.
 * This is a faithful extraction of the former `PluginEngine.createContext`
 * private method -- no behaviour changes.
 */
/**
 * Service config access-control — a plugin can only read the config of services it declared in
 * its manifest's `services` array. Missing / empty = no access. Denied requests return null and
 * log a warning so a misconfigured plugin is easy to diagnose.
 */
function checkServiceAccess(pluginId: string, allowedServices: string[] | undefined, serviceType: string, logger: FastifyBaseLogger): boolean {
  if (!allowedServices || allowedServices.length === 0) {
    logger.warn(
      { plugin: pluginId, attemptedService: serviceType },
      `[plugins] Plugin "${pluginId}" requested service "${serviceType}" but declares no services in its manifest — access denied`
    );
    return false;
  }
  if (!allowedServices.includes(serviceType)) {
    logger.warn(
      { plugin: pluginId, attemptedService: serviceType, allowed: allowedServices },
      `[plugins] Plugin "${pluginId}" requested service "${serviceType}" which is not in its manifest services list — access denied`
    );
    return false;
  }
  return true;
}

/**
 * Capability enforcement — any ctx method covered by a capability throws at call time if the plugin
 * didn't declare that capability in its manifest. We keep the method present on the returned object
 * (rather than `undefined`) so the error message is actionable instead of "undefined is not a function".
 * `log` is always granted (no sensitive access). Service methods are gated separately by L2 (services list).
 */
function requireCapability(
  pluginId: string,
  allowedCaps: ReadonlySet<PluginCapability>,
  required: PluginCapability,
  methodName: string
): void {
  if (!allowedCaps.has(required)) {
    throw new Error(
      `Plugin "${pluginId}" called ${methodName}() but didn't declare capability "${required}" in its manifest. ` +
      `Add "${required}" to manifest.capabilities to grant access.`
    );
  }
}

export function createContextV1(manifest: PluginManifest, deps: V1FactoryDeps): PluginContext {
  const pluginId = manifest.id;
  const log = deps.logger
    ? createCapturingLogger(deps.logger, pluginId)
    : deps.makeFallbackLogger(pluginId);
  const allowedServices = manifest.services;
  const caps = new Set<PluginCapability>(manifest.capabilities ?? []);
  const aclLogger = deps.logger ?? log;
  const req = (cap: PluginCapability, method: string) => requireCapability(pluginId, caps, cap, method);

  return {
    log,
    async getUser(userId: number) {
      req('users:read', 'getUser');
      return prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, displayName: true, role: true, avatar: true },
      });
    },
    async findUserByEmail(email: string) {
      req('users:read', 'findUserByEmail');
      return prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, displayName: true, role: true, avatar: true },
      });
    },
    async findUserByProvider(provider: string, providerId: string) {
      req('users:read', 'findUserByProvider');
      const link = await prisma.userProvider.findUnique({
        where: { provider_providerId: { provider, providerId } },
        include: { user: { select: { id: true, email: true, displayName: true, role: true, avatar: true } } },
      });
      return link?.user ?? null;
    },
    async setUserRole(userId: number, roleName: string) {
      req('users:write', 'setUserRole');
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) throw new Error(`Role "${roleName}" does not exist`);
      await prisma.user.update({ where: { id: userId }, data: { role: roleName } });
    },
    async setUserDisabled(userId: number, disabled: boolean) {
      req('users:write', 'setUserDisabled');
      if (disabled) {
        const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
        if (target?.role === 'admin') {
          throw new Error(`Refusing to disable user ${userId}: admins cannot be disabled from plugin code`);
        }
      }
      await prisma.user.update({ where: { id: userId }, data: { disabled } });
    },
    async issueAuthToken(userId: number) {
      req('users:write', 'issueAuthToken');
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true },
      });
      if (!user) throw new Error(`User ${userId} not found`);
      return deps.signAuthToken({ id: user.id, email: user.email, role: user.role });
    },
    getPluginDataDir() {
      req('settings:plugin', 'getPluginDataDir');
      return getPluginDataDir(pluginId);
    },
    async getAppSettings() {
      req('settings:app', 'getAppSettings');
      const s = await prisma.appSettings.findUnique({ where: { id: 1 } });
      return (s ?? {}) as Record<string, unknown>;
    },
    async getSetting(key: string) {
      req('settings:plugin', 'getSetting');
      const settings = await deps.getCachedSettings(pluginId);
      return settings[key];
    },
    async setSetting(key: string, value: unknown) {
      req('settings:plugin', 'setSetting');
      const settings = await deps.getCachedSettings(pluginId);
      settings[key] = value;
      await prisma.pluginState.update({
        where: { pluginId },
        data: { settings: JSON.stringify(settings) },
      });
      deps.setSettingsCache(pluginId, settings);
    },
    async sendNotification(type: string, data: NotificationPayload) {
      req('notifications', 'sendNotification');
      await notificationRegistry.send(type, data);
    },
    async sendUserNotification(userId: number, payload) {
      req('notifications', 'sendUserNotification');
      await sendUserNotification(userId, payload);
    },
    getArrClient: (serviceType: string) => {
      if (!checkServiceAccess(pluginId, allowedServices, serviceType, aclLogger)) {
        throw new Error(`Plugin "${pluginId}" is not allowed to access service "${serviceType}" — declare it in manifest.services`);
      }
      return getArrClient(serviceType);
    },
    async getServiceConfig(serviceType: string) {
      if (!checkServiceAccess(pluginId, allowedServices, serviceType, aclLogger)) return null;
      // Filter by enabled — plugins shouldn't keep using a service the admin just disabled.
      const svc = await prisma.service.findFirst({ where: { type: serviceType, enabled: true } });
      if (!svc) return null;
      try {
        // parseServiceConfig() decrypts AES-256-GCM-encrypted secret fields transparently —
        // plugins always receive the plaintext value they need to authenticate against the
        // upstream instance.
        const config = parseServiceConfig(svc.config);
        return { url: config.url || config.baseUrl, apiKey: config.apiKey };
      } catch {
        return null;
      }
    },
    async getServiceConfigRaw(serviceType: string) {
      if (!checkServiceAccess(pluginId, allowedServices, serviceType, aclLogger)) return null;
      const svc = await prisma.service.findFirst({ where: { type: serviceType, enabled: true } });
      if (!svc) return null;
      try {
        return parseServiceConfig(svc.config) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    async getUserProviders(userId: number) {
      req('users:read', 'getUserProviders');
      const providers = await prisma.userProvider.findMany({
        where: { userId },
        select: { provider: true, providerId: true, providerUsername: true, providerEmail: true },
      });
      return providers;
    },
    registerRoutePermission(routeKey: string, rule: { permission: string; ownerScoped?: boolean }) {
      req('permissions', 'registerRoutePermission');
      // A plugin can only rewrite RBAC rules for routes under its own namespace — without this
      // guard a plugin with the `permissions` capability could downgrade core admin routes
      // (e.g. `POST:/api/plugins/install`) to $public and escalate arbitrarily.
      const parsed = /^([A-Z]+):(\/.+)$/.exec(routeKey);
      const allowedPrefix = `/api/plugins/${pluginId}/`;
      if (!parsed || !parsed[2].startsWith(allowedPrefix)) {
        throw new Error(
          `Plugin "${pluginId}" may only register route permissions under ${allowedPrefix} (got "${routeKey}")`
        );
      }
      rbacRegisterRoute(pluginId, routeKey, rule);
    },
    registerPluginPermission(permission: string, description?: string) {
      req('permissions', 'registerPluginPermission');
      rbacRegisterPermission(pluginId, permission, description);
    },
    events: {
      on: (event, handler) => {
        req('events', 'events.on');
        pluginEventBus.on(event, handler, pluginId);
      },
      off: (event, handler) => {
        req('events', 'events.off');
        pluginEventBus.off(event, handler);
      },
      emit: (event, data) => {
        req('events', 'events.emit');
        return pluginEventBus.emit(event, data);
      },
    },

    kv: {
      async get<T>(key: string) {
        req('storage:plugin', 'kv.get');
        const kv = await getKV(pluginId);
        return kv.get<T>(key);
      },
      async set<T>(key: string, value: T) {
        req('storage:plugin', 'kv.set');
        const kv = await getKV(pluginId);
        return kv.set(key, value);
      },
      async delete(key: string) {
        req('storage:plugin', 'kv.delete');
        const kv = await getKV(pluginId);
        return kv.delete(key);
      },
      async keys() {
        req('storage:plugin', 'kv.keys');
        const kv = await getKV(pluginId);
        return kv.keys();
      },
    },
    db: {
      open(name: string, migrations?: Migration[]) {
        req('storage:plugin', 'db.open');
        return openPluginDb(pluginId, name, migrations);
      },
      migrate(db: PluginDatabase, migrations: Migration[]) {
        req('storage:plugin', 'db.migrate');
        return migrateDb(db, migrations);
      },
    },

    // ─── v1.1 additions — stubs filled in by subsequent phase commits ───
    // Each method here is a typed placeholder so the `PluginContext` type is satisfied; the
    // real implementation lands in the corresponding phase (see feat/plugin-ctx-v1.1 PR).
    // Stubs throw with a recognisable error so any accidental call before its phase lands
    // surfaces loudly instead of silently returning undefined.

    async getArrClients(serviceType: string): Promise<ArrClient[]> {
      // Pluriel of getArrClient: returns every enabled instance for the type. ACL check is
      // shared with the singular form (services[] manifest declaration).
      if (!checkServiceAccess(pluginId, allowedServices, serviceType, aclLogger)) {
        throw new Error(`Plugin "${pluginId}" is not allowed to access service "${serviceType}" — declare it in manifest.services`);
      }
      const services = await getAllServices(serviceType);
      return services.map(s => createArrClient(serviceType, s.config));
    },
    tmdb: {
      // `lang` omitted → backend's `normalizeLang` picks the instance default from AppSettings,
      // so plugins get locale-consistent metadata out of the box. Responses are cached 1h
      // (search) / 24h (details) by tmdb.ts — plugins don't need their own cache.
      async search(query: string, options?: { page?: number; lang?: string }): Promise<PluginTmdbSearchPage> {
        req('tmdb:read', 'tmdb.search');
        const data = await searchMulti(query, options?.page ?? 1, options?.lang);
        return data as PluginTmdbSearchPage;
      },
      async movie(tmdbId: number, options?: { lang?: string }) {
        req('tmdb:read', 'tmdb.movie');
        return getMovieDetails(tmdbId, options?.lang);
      },
      async tv(tmdbId: number, options?: { lang?: string }) {
        req('tmdb:read', 'tmdb.tv');
        return getTvDetails(tmdbId, options?.lang);
      },
    },
    media: {
      async batchStatus(items, userId) {
        req('requests:read', 'media.batchStatus');
        if (items.length === 0) return {};
        // Hard cap to prevent a bug (or malicious plugin) from generating a 10k-clause OR
        // query that would pin SQLite's parser. Mirrors the `listForUser` pattern (max 200).
        if (items.length > 500) {
          throw new Error(`ctx.media.batchStatus: items length ${items.length} exceeds the 500 cap — slice your list or filter upstream`);
        }
        // Two-pass query so we don't fetch the whole Media table:
        // 1. One findMany on the union of (tmdbId,mediaType) pairs → media status per item.
        // 2. One findMany on MediaRequest filtered by userId + the same media ids → user state.
        // This replaces an N+1 pattern a plugin would otherwise hit (loop per item calling
        // getMediaByTmdb).
        const mediaRows = await prisma.media.findMany({
          where: {
            OR: items.map(i => ({ tmdbId: i.tmdbId, mediaType: i.mediaType })),
          },
          select: { id: true, tmdbId: true, mediaType: true, status: true },
        });
        const mediaByKey = new Map<string, { id: number; status: string }>();
        for (const m of mediaRows) mediaByKey.set(`${m.mediaType}:${m.tmdbId}`, { id: m.id, status: m.status });

        const userRequestsByMediaId = new Map<number, string>();
        if (userId !== undefined && mediaRows.length > 0) {
          const reqs = await prisma.mediaRequest.findMany({
            where: {
              userId,
              mediaId: { in: mediaRows.map(m => m.id) },
              status: { in: [...ACTIVE_REQUEST_STATUSES] },
            },
            select: { mediaId: true, status: true },
            orderBy: { createdAt: 'desc' },
          });
          // Keep the most recent active request per media (orderBy desc + Map.set overwrites).
          for (const r of reqs) {
            if (!userRequestsByMediaId.has(r.mediaId)) userRequestsByMediaId.set(r.mediaId, r.status);
          }
        }

        const out: Record<PluginMediaBatchKey, PluginMediaBatchStatus> = {};
        for (const item of items) {
          const key: PluginMediaBatchKey = `${item.mediaType}:${item.tmdbId}`;
          const m = mediaByKey.get(key);
          const userStatus = m ? userRequestsByMediaId.get(m.id) ?? null : null;
          out[key] = {
            status: m?.status ?? 'unknown',
            userRequestStatus: userStatus,
            userHasActiveRequest: userStatus !== null,
          };
        }
        return out;
      },
      async getById(mediaId: number) {
        req('requests:read', 'media.getById');
        const row = await prisma.media.findUnique({
          where: { id: mediaId },
          select: { id: true, tmdbId: true, tvdbId: true, mediaType: true, title: true, posterPath: true, status: true },
        });
        if (!row) return null;
        return {
          id: row.id,
          tmdbId: row.tmdbId,
          tvdbId: row.tvdbId,
          mediaType: row.mediaType as 'movie' | 'tv',
          title: row.title,
          posterPath: row.posterPath,
          status: row.status,
        } satisfies PluginMedia;
      },
    },
    requests: {
      async listForUser(userId: number, options?: { limit?: number; status?: string }) {
        req('requests:read', 'requests.listForUser');
        const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
        const rows = await prisma.mediaRequest.findMany({
          where: {
            userId,
            ...(options?.status ? { status: options.status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true, userId: true, mediaType: true, seasons: true, status: true, createdAt: true,
            media: { select: { id: true, tmdbId: true, tvdbId: true, mediaType: true, title: true, posterPath: true, status: true } },
          },
        });
        return rows.map((r): PluginMediaRequest => ({
          id: r.id,
          userId: r.userId,
          mediaType: r.mediaType as 'movie' | 'tv',
          seasons: r.seasons ? (JSON.parse(r.seasons) as number[]) : null,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          media: {
            id: r.media.id,
            tmdbId: r.media.tmdbId,
            tvdbId: r.media.tvdbId,
            mediaType: r.media.mediaType as 'movie' | 'tv',
            title: r.media.title,
            posterPath: r.media.posterPath,
            status: r.media.status,
          },
        }));
      },
      async create(input) {
        req('requests:write', 'requests.create');
        // Runtime validation at the boundary — TypeScript only guards compile-time callers,
        // but plugins load plain JS from disk and can pass anything. Catch obvious garbage
        // here rather than forwarding NaN into Prisma where the error becomes opaque.
        if (!Number.isInteger(input?.userId) || input.userId < 1) {
          return { ok: false, code: 'INVALID_INPUT', error: 'userId must be a positive integer' };
        }
        // Delegates to the same createUserRequest pipeline the HTTP route uses — pluginGuard
        // + blacklist + dedup + quality gate + sendToService + safeNotify all honoured.
        // Target user's role (loaded from DB inside createUserRequest) drives auto-approve;
        // plugins cannot escalate by passing a userId they don't "own" — they always act as
        // that user would act via the HTTP API.
        const result = await createUserRequest({
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
          seasons: input.seasons,
          rootFolder: input.rootFolder,
          qualityOptionId: input.qualityOptionId,
          skipPluginGuard: input.skipPluginGuard,
        });
        if (!result.ok) return { ok: false, code: result.code, error: result.error };
        return {
          ok: true,
          requestId: result.request.id,
          status: result.request.status,
          autoApproved: result.request.status === 'approved' || result.request.status === 'searching',
          sendFailed: result.sendFailed,
        };
      },
    },
    app: {
      async internalFetch(path, init) {
        // Resolve port once per call — PORT is set at boot by index.ts, no caching needed.
        // The CSRF gate (@fastify/helmet + x-requested-with check on mutations) passes because
        // we always set the marker header; RBAC enforcement is the target route's job.
        const port = process.env.PORT || '3001';
        const base = `http://localhost:${port}`;
        const url = base + (path.startsWith('/') ? path : `/${path}`);
        const headers: Record<string, string> = {
          'x-requested-with': 'oscarr',
          ...init?.headers,
        };
        if (init?.asUserId !== undefined) {
          const user = await prisma.user.findUnique({
            where: { id: init.asUserId },
            select: { id: true, email: true, role: true },
          });
          if (!user) throw new Error(`internalFetch asUserId=${init.asUserId}: user not found`);
          // `token` is the cookie name set by routes/auth.ts + read by @fastify/jwt's
          // cookie extractor (bootstrap/security.ts). Minting via signAuthToken keeps the
          // plugin path identical to a normal login from RBAC's perspective.
          const jwt = deps.signAuthToken({ id: user.id, email: user.email, role: user.role });
          headers.cookie = `token=${jwt}`;
        }
        let body: BodyInit | undefined;
        if (init?.body !== undefined) {
          if (typeof init.body === 'string' || init.body instanceof Uint8Array || init.body instanceof URLSearchParams) {
            body = init.body as BodyInit;
          } else {
            body = JSON.stringify(init.body);
            if (!headers['content-type']) headers['content-type'] = 'application/json';
          }
        }
        return fetch(url, { method: init?.method ?? 'GET', headers, body });
      },
    },
    async listFolderRules(options?): Promise<PluginFolderRule[]> {
      req('settings:app', 'listFolderRules');
      const rows = await prisma.folderRule.findMany({
        where: options?.enabled !== undefined ? { enabled: options.enabled } : undefined,
        orderBy: { priority: 'asc' },
      });
      return rows.map((r): PluginFolderRule => ({
        id: r.id,
        name: r.name,
        priority: r.priority,
        mediaType: r.mediaType,
        // conditions is stored as JSON string; parse here so the plugin API returns a real
        // array (matching PluginFolderRule's shape). Defensive fallback: [] on malformed JSON
        // — admin-typed data, but we'd rather return nothing than crash the plugin.
        conditions: (() => {
          try {
            const parsed = JSON.parse(r.conditions);
            return Array.isArray(parsed) ? parsed : [];
          } catch { return []; }
        })(),
        folderPath: r.folderPath,
        seriesType: r.seriesType,
        serviceId: r.serviceId,
        enabled: r.enabled,
      }));
    },
  };
}
