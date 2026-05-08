import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';

// ── Fresh user state lookup (cached 30s per user) ───────────────────────────
const _userStateCache = new Map<number, { role: string; disabled: boolean; at: number }>();
const USER_STATE_CACHE_TTL = 30_000;

async function getFreshUserState(
  userId: number,
  jwtRole: string
): Promise<{ role: string; disabled: boolean }> {
  const cached = _userStateCache.get(userId);
  if (cached && Date.now() - cached.at < USER_STATE_CACHE_TTL) {
    return { role: cached.role, disabled: cached.disabled };
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, disabled: true },
    });
    const state = { role: user?.role ?? jwtRole, disabled: user?.disabled ?? false };
    _userStateCache.set(userId, { ...state, at: Date.now() });
    return state;
  } catch (err) {
    // Fail-closed: a DB outage shouldn't grant a disabled user authorization. If a stale
    // cache entry exists we keep using it (last-known-good); otherwise treat as disabled.
    const { logEvent } = await import('../utils/logEvent.js');
    logEvent('error', 'RBAC', `getFreshUserState DB lookup failed for user ${userId}: ${String(err)}`)
      .catch(() => { /* never mask the auth path on logEvent failure */ });
    if (cached) return { role: cached.role, disabled: cached.disabled };
    return { role: jwtRole, disabled: true };
  }
}

export function invalidateUserStateCache(userId?: number): void {
  if (userId === undefined) _userStateCache.clear();
  else _userStateCache.delete(userId);
}

// ── Special permission markers ───────────────────────────────────────────────
export const PUBLIC = '$public';
export const AUTH = '$authenticated';

// ── Types ────────────────────────────────────────────────────────────────────
interface RouteRule {
  permission: string;
  ownerScoped?: boolean;
}

// ── Route permissions map (METHOD:path -> rule) ───────────────────────────────
// Paths must match Fastify's routeOptions.url (parameterized, with prefix)
const ROUTE_PERMISSIONS: Record<string, RouteRule> = {
  // ── Auth (public) ──
  'GET:/api/auth/providers':             { permission: PUBLIC },
  'POST:/api/auth/register':             { permission: PUBLIC },
  'POST:/api/auth/login':                { permission: PUBLIC },
  'POST:/api/auth/link-provider':        { permission: AUTH },
  'GET:/api/auth/me':                    { permission: AUTH },
  'PUT:/api/auth/me/avatar-source':      { permission: AUTH },
  'POST:/api/auth/logout':               { permission: AUTH },

  // ── TMDB (any user) ──
  'GET:/api/tmdb/trending':                            { permission: AUTH },
  'GET:/api/tmdb/movies/popular':                      { permission: AUTH },
  'GET:/api/tmdb/tv/popular':                          { permission: AUTH },
  'GET:/api/tmdb/tv/trending-anime':                   { permission: AUTH },
  'GET:/api/tmdb/movies/upcoming':                     { permission: AUTH },
  'GET:/api/tmdb/search':                              { permission: AUTH },
  'GET:/api/tmdb/movie/:id':                           { permission: AUTH },
  'GET:/api/tmdb/tv/:id':                              { permission: AUTH },
  'GET:/api/tmdb/movie/:id/recommendations':           { permission: AUTH },
  'GET:/api/tmdb/tv/:id/recommendations':              { permission: AUTH },
  'GET:/api/tmdb/person/:id':                           { permission: AUTH },
  'GET:/api/tmdb/collection/:id':                      { permission: AUTH },
  'GET:/api/tmdb/discover/:mediaType/genre/:genreId':  { permission: AUTH },
  'GET:/api/tmdb/genre-backdrops':                     { permission: AUTH },
  'GET:/api/tmdb/genres/:mediaType':                   { permission: AUTH },
  'GET:/api/tmdb/discover/:mediaType':                 { permission: AUTH },

  // ── Requests ──
  'GET:/api/requests/':                  { permission: 'requests.read', ownerScoped: true },
  'GET:/api/requests/stats':             { permission: 'requests.read', ownerScoped: true },
  'POST:/api/requests/':                 { permission: 'requests.create' },
  'POST:/api/requests/collection':       { permission: 'requests.create' },
  'POST:/api/requests/search-missing':   { permission: 'requests.create' },
  'GET:/api/requests/:id/resolve':        { permission: 'requests.approve' },
  'PUT:/api/requests/:id':                { permission: 'requests.approve' },
  'POST:/api/requests/cleanup':           { permission: 'admin.danger' },
  'GET:/api/admin/blacklist/check':       { permission: AUTH },
  'POST:/api/requests/:id/approve':      { permission: 'requests.approve' },
  'POST:/api/requests/:id/decline':      { permission: 'requests.decline' },
  'DELETE:/api/requests/:id':            { permission: 'requests.delete', ownerScoped: true },

  // ── Media (any user) ──
  'GET:/api/media/':                     { permission: AUTH },
  'GET:/api/media/:id':                  { permission: AUTH },
  'GET:/api/media/tmdb/:tmdbId/:mediaType': { permission: AUTH },
  'GET:/api/media/recent':               { permission: AUTH },
  'POST:/api/media/batch-status':        { permission: AUTH },
  'GET:/api/media/episodes':             { permission: AUTH },
  'GET:/api/media/nsfw-ids':             { permission: AUTH },

  // ── Services status (any user) ──
  'GET:/api/services/radarr/status':     { permission: AUTH },
  'GET:/api/services/sonarr/status':     { permission: AUTH },
  'GET:/api/services/radarr/queue':      { permission: AUTH },
  'GET:/api/services/sonarr/queue':      { permission: AUTH },
  'GET:/api/services/downloads':         { permission: AUTH },
  'GET:/api/services/stats':             { permission: AUTH },
  'GET:/api/services/calendar':          { permission: AUTH },

  // ── App ──
  'GET:/api/app/version':                { permission: AUTH },
  'GET:/api/app/changelog':              { permission: AUTH },
  'GET:/api/app/banner':                 { permission: PUBLIC },
  'GET:/api/app/health':                 { permission: PUBLIC },  // Auth via API key, not JWT
  'GET:/api/app/quality-options':        { permission: AUTH },
  'GET:/api/app/features':               { permission: PUBLIC },
  'GET:/api/app/homepage-layout':        { permission: PUBLIC },
  'GET:/api/app/vapid-key':              { permission: PUBLIC },

  // ── Notifications (always own) ──
  'GET:/api/notifications/':             { permission: AUTH },
  'GET:/api/notifications/unread-count': { permission: AUTH },
  'PUT:/api/notifications/:id/read':     { permission: AUTH },
  'PUT:/api/notifications/read-all':     { permission: AUTH },
  'DELETE:/api/notifications/:id':       { permission: AUTH },

  // ── Push notifications ──
  'POST:/api/push/subscribe':    { permission: AUTH },
  'DELETE:/api/push/unsubscribe': { permission: AUTH },

  // ── Plugins ──
  'GET:/api/plugins/':                   { permission: 'admin.plugins' },
  'PUT:/api/plugins/:id/toggle':         { permission: 'admin.plugins' },
  'GET:/api/plugins/:id/settings':       { permission: 'admin.plugins' },
  'PUT:/api/plugins/:id/settings':       { permission: 'admin.plugins' },
  'GET:/api/plugins/ui/:hookPoint':      { permission: AUTH },
  'GET:/api/plugins/:id/logs':           { permission: 'admin.plugins' },
  'GET:/api/plugins/:id/frontend/*':     { permission: AUTH },
  // Reveals the absolute plugins directory on the host — admin-only. Consumed by the
  // admin PluginsTab / PluginDocsModal / ManualInstallModal to show the correct path hint.
  'GET:/api/plugins/dir':                { permission: 'admin.plugins' },
  'GET:/api/plugins/features':           { permission: PUBLIC },
  'GET:/api/plugins/registry':           { permission: AUTH },  // Plugin discovery — any authenticated user
  // Admin-only side of the plugin engine — install + updates must NOT fall through
  // to the /api/plugins = AUTH prefix default, otherwise any user can RCE the server.
  'POST:/api/plugins/install':           { permission: 'admin.plugins' },
  'POST:/api/plugins/:id/uninstall':     { permission: 'admin.plugins' },
  'GET:/api/plugins/updates':            { permission: 'admin.plugins' },

  // ── Admin auth-provider settings ──
  'GET:/api/admin/auth-providers':           { permission: 'admin.*' },
  'GET:/api/admin/auth-providers/syncable':  { permission: 'admin.*' },
  'PATCH:/api/admin/auth-providers/:id':     { permission: 'admin.*' },

  // ── Admin RBAC routes ──
  'GET:/api/admin/roles':                { permission: 'admin.roles' },
  'POST:/api/admin/roles':               { permission: 'admin.roles' },
  'PUT:/api/admin/roles/:id':            { permission: 'admin.roles' },
  'DELETE:/api/admin/roles/:id':         { permission: 'admin.roles' },
  'GET:/api/admin/permissions':          { permission: 'admin.roles' },
  'GET:/api/admin/homepage':             { permission: 'admin.*' },
  'PUT:/api/admin/homepage':             { permission: 'admin.*' },
  'POST:/api/admin/homepage/preview':    { permission: 'admin.*' },
  'POST:/api/admin/restart':             { permission: 'admin.*' },
};

// ── Prefix-based fallback (first match wins — order matters) ────────────────
const PREFIX_DEFAULTS: [string, RouteRule][] = [
  ['/api/admin',    { permission: 'admin.*' }],
  // Plugin custom routes fall through here (registered dynamically by plugins at /api/plugins/:pluginId/*).
  // Any authenticated user can access. Plugins that need admin-only routes should use
  // ctx.registerRoutePermission() to override specific routes.
  ['/api/tmdb',     { permission: AUTH }],    // All TMDB endpoints — any authenticated user
  ['/api/plugins',  { permission: AUTH }],
  ['/api/setup',    { permission: PUBLIC }],  // setup has its own secret-based guards
  ['/api/auth',     { permission: PUBLIC }],  // OAuth callback routes registered dynamically
  ['/api/webhooks', { permission: PUBLIC }],  // Auth via API key in handler
  ['/api/v1',       { permission: PUBLIC }],  // Seerr-compat layer — auth via X-Api-Key (UserApiKey) at the route level
];

// ── DB-backed role cache ────────────────────────────────────────────────────
let roleCache: Record<string, string[]> = {};
let roleCacheReady = false;

// Fallback used before DB is available (app boot)
const FALLBACK_ROLES: Record<string, string[]> = {
  admin: ['*'],
  user: [AUTH, 'requests.read', 'requests.create', 'requests.delete'],
};

async function loadRolesFromDb(): Promise<void> {
  try {
    const roles = await prisma.role.findMany();
    const map: Record<string, string[]> = {};
    for (const role of roles) {
      map[role.name] = JSON.parse(role.permissions) as string[];
    }
    roleCache = map;
    roleCacheReady = true;
  } catch (err) {
    void import('../utils/logEvent.js').then(({ logEvent }) =>
      logEvent('warn', 'RBAC', `Failed to load roles from DB, using fallback: ${String(err)}`)
    ).catch(() => { /* never mask the auth path */ });
    roleCache = { ...FALLBACK_ROLES };
  }
}

/** Call this after any role CRUD to refresh the cache */
export async function invalidateRoleCache(): Promise<void> {
  await loadRolesFromDb();
}

/** Return the permissions array for a given role name */
export function getPermissionsForRole(roleName: string): string[] {
  const permissions = roleCacheReady ? roleCache[roleName] : FALLBACK_ROLES[roleName];
  return permissions ?? [];
}

// ── Permission descriptions (for admin UI) ─────────────────────────────────
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'admin.*':           'Full access to the admin panel',
  'admin.plugins':     'Manage plugins (enable/disable, settings)',
  'admin.roles':       'Manage roles and permissions',
  'requests.read':     'View media requests',
  'requests.create':   'Create new media requests',
  'requests.delete':   'Delete own media requests',
  'requests.approve':  'Approve pending requests',
  'requests.decline':  'Decline pending requests',
  'admin.danger':      'Execute bulk cleanup and dangerous data operations',
};

// ── Plugin overrides (plugins can add/replace rules at runtime) ─────────────
// Keyed by METHOD:url like ROUTE_PERMISSIONS. We additionally track which pluginId owns
// each entry so togglePlugin(false) / uninstall can cleanly tear them down — otherwise a
// stale override would outlive the plugin and keep affecting routing until process restart.
const pluginOverrides: Record<string, RouteRule> = {};
const pluginOverrideOwners = new Map<string, Set<string>>(); // pluginId -> set of routeKeys
const pluginPermissions: { key: string; description?: string; pluginId: string }[] = [];

/**
 * Register a plugin-scoped route permission. Defense-in-depth: even though ctx/v1.ts already
 * validates the routeKey starts with `/api/plugins/${pluginId}/`, we re-check here so any
 * other caller (tests, future internal code) can't accidentally register a core-route override.
 */
export function registerRoutePermission(pluginId: string, key: string, rule: RouteRule): void {
  const allowedPrefix = `/api/plugins/${pluginId}/`;
  const parsed = /^([A-Z]+):(\/.+)$/.exec(key);
  if (!parsed || !parsed[2].startsWith(allowedPrefix)) {
    throw new Error(`Route permission "${key}" is outside plugin "${pluginId}" namespace (${allowedPrefix})`);
  }
  pluginOverrides[key] = rule;
  let owned = pluginOverrideOwners.get(pluginId);
  if (!owned) {
    owned = new Set();
    pluginOverrideOwners.set(pluginId, owned);
  }
  owned.add(key);
}

/**
 * Allow plugins to declare new permissions (visible in admin role editor).
 */
export function registerPluginPermission(pluginId: string, permission: string, description?: string): void {
  if (!pluginPermissions.some(p => p.key === permission)) {
    pluginPermissions.push({ key: permission, description, pluginId });
  }
}

/**
 * Drop every RBAC entry owned by a plugin. Called on disable + uninstall so a plugin can't
 * leave lingering rules that affect routing after it's no longer running.
 */
export function unregisterPluginRbac(pluginId: string): void {
  const owned = pluginOverrideOwners.get(pluginId);
  if (owned) {
    for (const key of owned) delete pluginOverrides[key];
    pluginOverrideOwners.delete(pluginId);
  }
  for (let i = pluginPermissions.length - 1; i >= 0; i--) {
    if (pluginPermissions[i].pluginId === pluginId) pluginPermissions.splice(i, 1);
  }
}

/**
 * Get all available permissions (core + plugins) for the admin role editor.
 */
export function getAllPermissions(): { key: string; description: string; source: 'core' | 'plugin' }[] {
  const corePerms = new Set<string>();
  for (const rule of Object.values(ROUTE_PERMISSIONS)) {
    if (rule.permission !== PUBLIC && rule.permission !== AUTH) {
      corePerms.add(rule.permission);
    }
  }
  corePerms.add('admin.*');

  const result: { key: string; description: string; source: 'core' | 'plugin' }[] = [];
  for (const p of [...corePerms].sort((a, b) => a.localeCompare(b))) {
    result.push({ key: p, description: PERMISSION_DESCRIPTIONS[p] || p, source: 'core' });
  }
  for (const p of [...pluginPermissions].sort((a, b) => a.key.localeCompare(b.key))) {
    result.push({ key: p.key, description: p.description || p.key, source: 'plugin' });
  }
  return result;
}

// ── Permission check ────────────────────────────────────────────────────────
function hasPermission(role: string, required: string): boolean {
  const permissions = roleCacheReady ? roleCache[role] : FALLBACK_ROLES[role];
  if (!permissions) return false;

  return permissions.some((p) => {
    if (p === '*') return true;
    if (p === required) return true;
    if (p.endsWith('.*')) {
      const prefix = p.slice(0, -2);
      return required.startsWith(prefix + '.') || required === prefix;
    }
    return false;
  });
}

// ── ownerScoped: skip if the role has broader access (e.g. can approve) ──────
function shouldOwnerScope(role: string, permission: string): boolean {
  // If the role has wildcard access, never owner-scope
  if (hasPermission(role, '*')) return false;
  // If the role has a broader permission in the same domain (e.g. requests.approve
  // alongside requests.read), it needs to see all resources — not just its own
  const domain = permission.split('.')[0];
  const broaderPerms = [`${domain}.approve`, `${domain}.decline`, `${domain}.manage`];
  for (const bp of broaderPerms) {
    if (hasPermission(role, bp)) return false;
  }
  return true;
}

// ── Route rule resolution ───────────────────────────────────────────────────
function resolveRule(method: string, url: string): RouteRule | null {
  const key = `${method}:${url}`;

  // 1. Plugin overrides first (highest priority)
  if (pluginOverrides[key]) return pluginOverrides[key];

  // 2. Exact match in static map
  if (ROUTE_PERMISSIONS[key]) return ROUTE_PERMISSIONS[key];

  // 3. Try with/without trailing slash
  const alt = url.endsWith('/') ? `${method}:${url.slice(0, -1)}` : `${method}:${url}/`;
  if (pluginOverrides[alt]) return pluginOverrides[alt];
  if (ROUTE_PERMISSIONS[alt]) return ROUTE_PERMISSIONS[alt];

  // 4. Prefix-based fallback (first match wins — order matters)
  for (const [prefix, rule] of PREFIX_DEFAULTS) {
    if (url.startsWith(prefix)) return rule;
  }

  return null;
}

/**
 * Enforce the RBAC rule for a plugin sub-route that has been resolved by the dispatcher.
 *
 * The catch-all on /api/plugins/:pluginId/* only satisfies the `/api/plugins` = AUTH prefix
 * default, so an authenticated user passes the global hook regardless of what the plugin
 * asked for via ctx.registerRoutePermission. Once the dispatcher has matched the sub-route
 * to its real URL, it calls this helper to apply the plugin-declared rule (if any) against
 * the already-authenticated request.
 *
 * Returns true when the request is allowed, false when a 4xx has been sent. Assumes global
 * RBAC already ran (request.user is set, disabled check done). Mirrors the role + owner-scope
 * logic of the main rbacPlugin hook.
 */
export function enforcePluginRoutePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  method: string,
  url: string
): boolean {
  const rule = resolveRule(method, url);
  if (!rule || rule.permission === PUBLIC || rule.permission === AUTH) return true;

  const jwtUser = request.user as { id: number; role: string } | undefined;
  if (!jwtUser) {
    reply.status(401).send({ error: 'UNAUTHORIZED' });
    return false;
  }

  const viewAsRole = request.headers['x-view-as-role'] as string | undefined;
  // Restrict to roles that actually exist — without this, header could be any string
  // (downstream hasPermission returns false on unknowns, so privilege escalation is
  // already blocked, but logging unknown attempts helps audit + tightens the surface).
  const isKnownRole = !!viewAsRole && (roleCacheReady ? roleCache[viewAsRole] !== undefined : viewAsRole in FALLBACK_ROLES);
  const effectiveRole = (isKnownRole && jwtUser.role === 'admin' && !rule.permission.startsWith('admin'))
    ? viewAsRole
    : jwtUser.role;

  if (!hasPermission(effectiveRole, rule.permission)) {
    reply.status(403).send({ error: 'FORBIDDEN' });
    return false;
  }

  if (rule.ownerScoped && shouldOwnerScope(effectiveRole, rule.permission)) {
    request.ownerScoped = true;
  }
  return true;
}

// ── Swagger tag helper ──────────────────────────────────────────────────────
export function getAccessTag(method: string, url: string): string {
  const rule = resolveRule(method, url);
  if (!rule || rule.permission === PUBLIC) return 'Public';
  if (rule.permission === AUTH) return 'Auth Required';
  if (rule.permission.startsWith('admin')) return 'Admin Only';
  return 'Auth Required';
}

// ── Fastify RBAC plugin ─────────────────────────────────────────────────────
export function rbacPlugin(app: FastifyInstance): void {
  // Load roles from DB on startup
  app.addHook('onReady', async () => {
    await loadRolesFromDb();
  });

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions?.url;
    const method = request.method;

    // Skip non-API routes (SPA fallback, static files)
    if (!url?.startsWith('/api/')) return;

    const rule = resolveRule(method, url);

    if (!rule) {
      // Fail-closed: no rule -> deny
      request.log.warn(`RBAC: no rule for ${method}:${url}, denying`);
      return reply.status(403).send({ error: 'FORBIDDEN' });
    }

    // Public route — no auth needed
    if (rule.permission === PUBLIC) return;

    // All non-public routes need a valid JWT
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'UNAUTHORIZED' });
    }

    // Fetch fresh state (role + disabled) — cached 30s
    const jwtUser = request.user as { id: number; role: string };
    const { role: freshRole, disabled } = await getFreshUserState(jwtUser.id, jwtUser.role);

    if (disabled) {
      return reply.status(403).send({ error: 'ACCOUNT_DISABLED' });
    }

    // Any authenticated user is enough
    if (rule.permission === AUTH) return;

    // "View as role" simulation — admin only, never applies to admin routes. Restrict to
    // known roles so an arbitrary header string can't reach hasPermission with junk input.
    const viewAsRole = request.headers['x-view-as-role'] as string | undefined;
    const isKnownRole = !!viewAsRole && (roleCacheReady ? roleCache[viewAsRole] !== undefined : viewAsRole in FALLBACK_ROLES);
    const effectiveRole = (isKnownRole && freshRole === 'admin' && !rule.permission.startsWith('admin'))
      ? viewAsRole
      : freshRole;

    if (!hasPermission(effectiveRole, rule.permission)) {
      return reply.status(403).send({ error: 'FORBIDDEN' });
    }

    // Flag owner-scoped routes for handlers
    if (rule.ownerScoped && shouldOwnerScope(effectiveRole, rule.permission)) {
      request.ownerScoped = true;
    }
  });
}
