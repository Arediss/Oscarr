import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, rm, lstat } from 'node:fs/promises';
import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { notificationRegistry } from '../notifications/index.js';
import { discoverPlugins } from './loader.js';
import { parseManifest } from './manifestSchema.js';
import { checkCompat, type CompatResult } from './compat.js';
import { cancelPluginJobs, updateJobSchedule } from '../services/scheduler.js';
import { createContext, clearLogRateCounter, type ContextFactoryDeps } from './context/index.js';
import { PluginRouter } from './router.js';
import { enforcePluginRoutePermission, unregisterPluginRbac } from '../middleware/rbac.js';
import { pluginEventBus } from './eventBus.js';
import { closePluginStorage, rmPluginDataDir } from './storage/index.js';
import type {
  LoadedPlugin,
  LoadedUIContribution,
  PluginGuardResult,
  PluginInfo,
  PluginManifest,
  PluginRegistration,
} from './types.js';

export class PluginEngine {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly settingsCache = new Map<string, Record<string, unknown>>();
  private readonly compatCache = new Map<string, CompatResult>();
  /** Per-plugin dispatch router. Key = pluginId. Presence = "this plugin's routes are live".
   *  Toggle off, uninstall, and hot-update just mutate this map — no Fastify restart needed. */
  private readonly routers = new Map<string, PluginRouter>();
  private dispatcherMounted = false;
  private logger: FastifyBaseLogger | null = null;
  private app: FastifyInstance | null = null;

  /** Call once after Fastify is ready to provide a structured logger. */
  setLogger(logger: FastifyBaseLogger): void {
    this.logger = logger;
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', msg: string): void {
    // Strip CR/LF from log lines so a plugin id like "foo\n[INFO] forged-line" can't splice
    // a fake entry into the log. Plugin ids reach this helper from request.params, so
    // sanitize once here rather than at every call site. KEEP `.replace()` (not `replaceAll`) —
    // CodeQL's `js/log-injection` sanitizer recognition is method-name specific.
    const sanitized = msg.replace(/\n/g, ' ').replace(/\r/g, ' ');
    if (this.logger) {
      this.logger[level](sanitized);
      return;
    }
    // Explicit branches (instead of resolving a `const fn = ternary`) so CodeQL traces the
    // sanitized value to each console.* sink directly — the ternary form was misread as
    // re-introducing taint at the call site.
    if (level === 'error') console.error('[PluginEngine]', sanitized);
    else if (level === 'warn') console.warn('[PluginEngine]', sanitized);
    else console.log('[PluginEngine]', sanitized);
  }

  /**
   * Shared "load one plugin from disk" pipeline used by both loadAll (boot) and loadSingle (runtime install).
   * Runs the compat check, upserts PluginState, dynamic-imports the entry, calls register(), runs onInstall
   * if first-time, registers notification providers, and stores the LoadedPlugin in the map. Does NOT
   * mount the plugin's router on the dispatcher — callers do that via _registerRoutes when appropriate.
   */
  private async _loadFromDisk(
    dir: string,
    manifest: PluginManifest,
    opts: { defaultEnabled: boolean; isSymlink?: boolean; hotReload?: boolean }
  ): Promise<LoadedPlugin> {
    const compat = checkCompat(manifest);
    this.compatCache.set(manifest.id, compat);
    if (compat.status === 'incompatible') {
      throw new Error(`Plugin "${manifest.id}" is incompatible: ${compat.reason}`);
    }

    const entryPath = join(dir, manifest.entry);
    // On hot-reload only, cache-bust the ESM URL so the swapped-in code is re-imported
    // instead of Node returning the cached old module (it keys by URL string). Boot-time
    // loads use the canonical URL so multiple restarts don't fragment the module cache.
    const baseUrl = pathToFileURL(entryPath).href;
    const moduleUrl = opts.hotReload ? `${baseUrl}?v=${Date.now()}` : baseUrl;
    const mod = await import(moduleUrl);
    if (typeof mod.register !== 'function') {
      throw new Error(`Plugin "${manifest.id}" does not export a register() function`);
    }

    // Persist state only after the module imports cleanly. If the import throws, we don't
    // leave an orphan PluginState row pointing at a plugin id that never actually loaded.
    const state = await prisma.pluginState.upsert({
      where: { pluginId: manifest.id },
      update: {},
      create: { pluginId: manifest.id, enabled: opts.defaultEnabled, settings: '{}' },
    });

    const ctx = createContext(manifest, this.getContextDeps());
    const registration: PluginRegistration = await mod.register(ctx);

    if (!state.onInstallRan && registration.onInstall) {
      await registration.onInstall(ctx);
      await prisma.pluginState.update({
        where: { pluginId: manifest.id },
        data: { onInstallRan: true },
      });
      this.log('info', `Ran onInstall for "${manifest.id}"`);
    }

    if (registration.registerNotificationProviders) {
      // Wrap so providers registered by this plugin are auto-tagged for cleanup on disable/uninstall.
      const scoped = new Proxy(notificationRegistry, {
        get(target, prop, receiver) {
          if (prop === 'registerProvider') {
            return (provider: Parameters<typeof target.registerProvider>[0]) =>
              target.registerProvider(provider, manifest.id);
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      registration.registerNotificationProviders(scoped);
    }

    const loaded: LoadedPlugin = {
      manifest,
      registration,
      dir,
      enabled: state.enabled,
      isSymlink: opts.isSymlink ?? false,
    };
    this.plugins.set(manifest.id, loaded);
    return loaded;
  }

  /** Build a PluginRouter for a plugin and store it in the dispatcher map. Idempotent — a second
   *  call for the same plugin replaces the previous router (used for hot-update down the line). */
  private async _registerRoutes(plugin: LoadedPlugin): Promise<void> {
    const registerRoutes = plugin.registration.registerRoutes;
    if (!registerRoutes) return;
    const { manifest } = plugin;
    try {
      const router = new PluginRouter();
      const ctx = createContext(manifest, this.getContextDeps());
      await registerRoutes(router, ctx);
      this.routers.set(manifest.id, router);
      this.log('info', `Mounted ${router.listRoutes().length} route(s) for "${manifest.id}"`);
    } catch (err) {
      this.log('error', `Route registration failed for "${manifest.id}": ${err}`);
      plugin.error = `Route registration failed: ${err}`;
      plugin.enabled = false;
      this.routers.delete(manifest.id);
      await prisma.pluginState.update({
        where: { pluginId: manifest.id },
        data: { enabled: false },
      }).catch((dbErr) => {
        this.log('error', `Failed to mark plugin "${manifest.id}" as disabled in DB after route error: ${dbErr}`);
      });
    }
  }

  /** Mount the single dispatcher catch-all on the live Fastify app. Called once from
   *  registerWithFastify — every plugin goes through it. */
  private mountDispatcher(app: FastifyInstance): void {
    if (this.dispatcherMounted) return;
    this.dispatcherMounted = true;

    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
    for (const method of methods) {
      app.route({
        method,
        // '*' is Fastify's wildcard that exposes the unmatched remainder as request.params['*'].
        url: '/api/plugins/:pluginId/*',
        handler: async (request, reply) => {
          const { pluginId } = request.params as { pluginId: string };
          const rest = (request.params as Record<string, string>)['*'] ?? '';
          const subUrl = `/${rest}`;

          const router = this.routers.get(pluginId);
          if (!router) {
            return reply.status(404).send({ error: 'Plugin not found or disabled' });
          }

          const match = router.match(method, subUrl);
          if (!match) {
            return reply.status(404).send({ error: 'Route not found' });
          }

          // Plugin-registered permission overrides (ctx.registerRoutePermission) are keyed by the
          // real URL the plugin declared — reconstruct it here so RBAC can find the rule.
          const fullUrl = `/api/plugins/${pluginId}${match.entry.pattern}`;
          if (!enforcePluginRoutePermission(request, reply, method, fullUrl)) return;

          // Swap the catch-all's params for the sub-route's params before calling the handler.
          (request as { params: Record<string, string> }).params = match.params;
          return router.runHandler(match, request, reply);
        },
      });
    }
    this.log('info', 'Plugin dispatcher mounted at /api/plugins/:pluginId/*');
  }

  /**
   * Load a single plugin from its directory at runtime. Used by the install flow to avoid a full restart.
   *
   * `defaultEnabled` controls the state when the plugin has never been seen before:
   *  - `true` (boot-time discovery) — preserves the current UX where filesystem-present plugins load enabled
   *  - `false` (runtime install) — gives the admin a chance to review capabilities before enabling
   */
  async loadSingle(dir: string, opts: { defaultEnabled?: boolean } = {}): Promise<LoadedPlugin> {
    const raw = await readFile(join(dir, 'manifest.json'), 'utf-8');
    const manifest = parseManifest(JSON.parse(raw), dir) as PluginManifest;

    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is already loaded`);
    }

    const isSymlink = await lstat(dir).then((s) => s.isSymbolicLink()).catch(() => false);
    const loaded = await this._loadFromDisk(dir, manifest, {
      defaultEnabled: opts.defaultEnabled ?? true,
      isSymlink,
      // loadSingle is the install/hot-update path — bust the ESM cache so a same-path
      // re-install (uninstall → install on the same plugin id) actually re-imports.
      hotReload: true,
    });
    if (loaded.enabled) await this._registerRoutes(loaded);
    this.log('info', `Loaded "${manifest.id}" v${manifest.version} via loadSingle`);
    return loaded;
  }

  async loadAll(): Promise<void> {
    const discovered = await discoverPlugins();
    this.log('info', `Discovered ${discovered.length} plugin(s)`);

    for (const { dir, manifest, isSymlink } of discovered) {
      try {
        await this._loadFromDisk(dir, manifest, { defaultEnabled: true, isSymlink });
        this.log('info', `Loaded "${manifest.id}" v${manifest.version}`);
      } catch (err) {
        this.log('error', `Failed to load plugin "${manifest.id}": ${err}`);
        this.plugins.set(manifest.id, {
          manifest,
          registration: { manifest } as PluginRegistration,
          dir,
          enabled: false,
          error: String(err),
          isSymlink,
        });
      }
    }
  }

  async registerWithFastify(app: FastifyInstance): Promise<void> {
    this.setLogger(app.log);
    this.app = app;
    this.mountDispatcher(app);

    // Routes register first (sync-ish, mostly local), then onEnable runs in parallel.
    // Routes have to be sequential — they share the Fastify dispatcher mount — but
    // onEnable is per-plugin background work (Discord bot login, websocket clients,
    // mailbox poll loops …) where one slow plugin would otherwise block Oscarr's boot
    // for the duration of every other plugin's startup combined.
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled || plugin.error) continue;
      if (plugin.registration.registerRoutes) {
        await this._registerRoutes(plugin);
      }
    }

    // Boot-time onEnable parity with togglePlugin: a plugin that's already enabled in the
    // DB needs its onEnable to run on every Oscarr restart, otherwise plugins doing
    // background work stay dormant until an admin toggles off+on. A plugin that does its
    // boot work inside `register()` won't have an `onEnable` hook to begin with — no-op
    // for them.
    const enableTasks: Array<Promise<void>> = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled || plugin.error) continue;
      if (!plugin.registration.onEnable) continue;
      const onEnable = plugin.registration.onEnable;
      const ctx = createContext(plugin.manifest, this.getContextDeps());
      enableTasks.push(
        Promise.resolve(onEnable(ctx)).catch((err) => {
          this.log('error', `Boot-time onEnable failed for "${plugin.manifest.id}": ${err}`);
          plugin.error = `onEnable failed at boot: ${err}`;
        }),
      );
    }
    await Promise.allSettled(enableTasks);
  }

  getJobHandlers(): Record<string, () => Promise<unknown>> {
    const handlers: Record<string, () => Promise<unknown>> = {};
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled || plugin.error || !plugin.registration.registerJobs) continue;
      try {
        const ctx = createContext(plugin.manifest, this.getContextDeps());
        const jobs = plugin.registration.registerJobs(ctx);
        for (const [key, handler] of Object.entries(jobs)) {
          handlers[key] = handler;
        }
      } catch (err) {
        this.log('error', `Failed to get job handlers for "${id}": ${err}`);
      }
    }
    return handlers;
  }

  getJobDefs(): { key: string; label: string; cron: string; pluginId: string }[] {
    const defs: { key: string; label: string; cron: string; pluginId: string }[] = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled || plugin.error) continue;
      for (const job of plugin.manifest.hooks?.jobs || []) {
        defs.push({ ...job, pluginId: plugin.manifest.id });
      }
    }
    return defs;
  }

  getUIContributions(hookPoint: string): LoadedUIContribution[] {
    const contributions: LoadedUIContribution[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled || plugin.error) continue;
      for (const ui of plugin.manifest.hooks?.ui || []) {
        if (ui.hookPoint === hookPoint) {
          contributions.push({ ...ui, pluginId: id });
        }
      }
    }
    return contributions.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /** Plugins whose on-disk load failed. Used by the boot bootstrap to surface a single
   *  aggregated warning once every plugin has been processed. */
  listFailed(): { id: string; error: string }[] {
    return Array.from(this.plugins.values())
      .filter((p) => p.error)
      .map((p) => ({ id: p.manifest.id, error: p.error as string }));
  }

  getAllFeatureFlags(): Record<string, boolean> {
    const flags: Record<string, boolean> = {};
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled || plugin.error) continue;
      Object.assign(flags, plugin.manifest.hooks?.features || {});
    }
    return flags;
  }

  getPluginList(): PluginInfo[] {
    return Array.from(this.plugins.values()).map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      author: p.manifest.author,
      enabled: p.enabled,
      hasSettings: (p.manifest.settings?.length ?? 0) > 0,
      hasFrontend: !!p.manifest.frontend,
      error: p.error,
      compat: this.compatCache.get(p.manifest.id),
      services: p.manifest.services,
      capabilities: p.manifest.capabilities,
      capabilityReasons: p.manifest.capabilityReasons,
      isSymlink: p.isSymlink === true,
    }));
  }

  getPlugin(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Uninstall a plugin at runtime: drop its dispatcher entry, pause its jobs, remove its dir.
   * Subsequent requests to /api/plugins/<id>/* hit the dispatcher's "not found" branch. No
   * Oscarr restart needed — the LoadedPlugin is also evicted so getPluginList stops listing it.
   */
  async uninstall(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    // Run onDisable so plugins can release resources (close DB pools, kill websockets,
    // drain queues) before we tear down their environment. Capped at 5s — a runaway
    // shutdown shouldn't block uninstall. Errors are logged, not thrown — the user
    // explicitly asked to uninstall and we honour that even if cleanup is partial.
    if (plugin.enabled && plugin.registration.onDisable) {
      try {
        const ctx = createContext(plugin.manifest, this.getContextDeps());
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('onDisable timed out after 5s')), 5000);
        });
        try {
          await Promise.race([plugin.registration.onDisable(ctx), timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } catch (err) {
        this.log('warn', `onDisable failed during uninstall of "${id}": ${err}`);
      }
    }

    // Drop every CronJob row owned by this plugin (queried by pluginId rather than the
    // manifest's declared list — covers jobs registered at runtime via registerJobs() that
    // the manifest doesn't list, e.g. dev plugins). In-process timers are cancelled too.
    try {
      const ownedRows = await prisma.cronJob.findMany({ where: { pluginId: id }, select: { key: true } });
      const ownedKeys = ownedRows.map((r) => r.key);
      cancelPluginJobs(id, ownedKeys);
      if (ownedKeys.length > 0) {
        await prisma.cronJob.deleteMany({ where: { pluginId: id } });
        this.log('info', `Deleted ${ownedKeys.length} CronJob row(s) for "${id}": ${ownedKeys.join(', ')}`);
      }
    } catch (err) {
      this.log('warn', `Failed to drop plugin jobs during uninstall of "${id}": ${err}`);
    }

    // Drop routes first so no in-flight request can still hit a handler whose module is about to die.
    this.routers.delete(id);
    unregisterPluginRbac(id);
    pluginEventBus.removeAllForPlugin(id);
    notificationRegistry.removeAllForPlugin(id);

    await prisma.pluginState.update({ where: { pluginId: id }, data: { enabled: false } })
      .catch((err) => this.log('warn', `Failed to mark plugin "${id}" disabled during uninstall: ${err}`));

    // Close any plugin-owned SQLite handles + drop KV cache BEFORE deleting the data dir,
    // otherwise the rm can fail on file-locked databases (Windows) or leave stale handles
    // pointing at unlinked inodes (Linux/Mac — works but messy).
    closePluginStorage(id);

    await rm(plugin.dir, { recursive: true, force: true }).catch((err) => {
      this.log('error', `Failed to delete plugin dir "${plugin.dir}": ${err}`);
    });
    await rmPluginDataDir(id).catch((err) => {
      this.log('warn', `Failed to delete data dir for "${id}": ${err}`);
    });

    this.plugins.delete(id);
    this.settingsCache.delete(id);
    this.compatCache.delete(id);
    clearLogRateCounter(id);
    this.log('info', `Uninstalled "${id}"`);
    return true;
  }

  async togglePlugin(id: string, enabled: boolean): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" not found`);

    // Refuse to toggle a plugin that never loaded — the registration is a stub (load
    // failed at import or compat check), so there is no real handler to run and the
    // PluginState row was never upserted. Without this guard the downstream
    // prisma.pluginState.update() throws "record not found" with a misleading stacktrace.
    if (plugin.error) {
      const compat = this.compatCache.get(id);
      const reason = compat?.status === 'incompatible'
        ? `Plugin "${id}" is incompatible with this Oscarr version: ${compat.reason}`
        : `Plugin "${id}" failed to load — fix the error before enabling: ${plugin.error}`;
      throw new Error(reason);
    }

    // Call lifecycle hook before persisting (best-effort, don't block toggle)
    try {
      if (enabled && plugin.registration.onEnable) {
        const ctx = createContext(plugin.manifest, this.getContextDeps());
        await plugin.registration.onEnable(ctx);
      } else if (!enabled && plugin.registration.onDisable) {
        const ctx = createContext(plugin.manifest, this.getContextDeps());
        await plugin.registration.onDisable(ctx);
      }
    } catch (err) {
      this.log('error', `Lifecycle hook ${enabled ? 'onEnable' : 'onDisable'} failed for "${id}": ${err}`);
    }

    await prisma.pluginState.update({
      where: { pluginId: id },
      data: { enabled },
    });
    plugin.enabled = enabled;
    this.settingsCache.delete(id);

    // Enable → mount (or re-mount) the plugin router; disable → drop it so requests 404.
    if (plugin.registration.registerRoutes) {
      if (enabled) {
        // Re-register from scratch. _registerRoutes rebuilds the ctx which re-runs
        // registerRoutePermission / registerPluginPermission calls, so the RBAC clear on
        // disable is rebuilt on enable without losing anything.
        await this._registerRoutes(plugin);
      } else {
        this.routers.delete(id);
        unregisterPluginRbac(id);
      }
    }

    // On disable: drop event-bus listeners + notif providers the plugin registered. Re-running
    // the lifecycle on re-enable will rebuild them — without this they leaked across toggles.
    // Also close any open SQLite handles + KV cache so a re-enable starts with fresh state
    // and the on-disk file isn't held open while disabled.
    if (!enabled) {
      pluginEventBus.removeAllForPlugin(id);
      notificationRegistry.removeAllForPlugin(id);
      closePluginStorage(id);
    }

    // Stop or restart plugin cron jobs — queried by pluginId so jobs registered at runtime
    // (via registerJobs() without a matching manifest hint) are covered too. Flips
    // CronJob.enabled to mirror the plugin state so the admin Jobs tab shows the right
    // status; manual per-job overrides are reset on toggle (acceptable simplicity).
    try {
      const ownedJobs = await prisma.cronJob.findMany({ where: { pluginId: id } });
      if (ownedJobs.length > 0) {
        await prisma.cronJob.updateMany({ where: { pluginId: id }, data: { enabled } });
        for (const dbJob of ownedJobs) {
          await updateJobSchedule(dbJob.key, dbJob.cronExpression, enabled);
        }
        this.log('info', `${enabled ? 'Resumed' : 'Paused'} ${ownedJobs.length} job(s) for plugin "${id}"`);
      }
    } catch (err) {
      this.log('error', `Failed to ${enabled ? 'resume' : 'pause'} jobs for plugin "${id}": ${err}`);
    }
  }

  async getSettings(id: string): Promise<{ schema: PluginManifest['settings']; values: Record<string, unknown> }> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" not found`);

    const values = await this.getCachedSettings(id);
    return { schema: plugin.manifest.settings || [], values };
  }

  async updateSettings(id: string, values: Record<string, unknown>): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin "${id}" not found`);

    const validationError = this.validateSettings(plugin.manifest, values);
    if (validationError) throw new Error(validationError);

    await prisma.pluginState.update({
      where: { pluginId: id },
      data: { settings: JSON.stringify(values) },
    });
    this.settingsCache.set(id, values);
  }

  async runGuards(
    guardName: string,
    userId: number,
    context?: import('./types.js').PluginGuardContext,
  ): Promise<PluginGuardResult | null> {
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled || plugin.error || !plugin.registration.registerGuards) continue;
      try {
        const ctx = createContext(plugin.manifest, this.getContextDeps());
        const guards = plugin.registration.registerGuards(ctx);
        const guard = guards[guardName];
        if (!guard) continue;
        const result = await guard(userId, context);
        if (result?.blocked) return result;
      } catch (err) {
        this.log('error', `Guard "${guardName}" failed for plugin "${id}": ${err}`);
      }
    }
    return null;
  }

  // ── Private helpers ───────────────────────────────────────────────

  private validateSettings(manifest: PluginManifest, values: Record<string, unknown>): string | null {
    const schema = manifest.settings || [];
    for (const field of schema) {
      const val = values[field.key];

      if (field.required && (val === undefined || val === null || val === '')) {
        return `Setting "${field.label}" is required`;
      }

      if (val === undefined || val === null || val === '') continue;

      switch (field.type) {
        case 'number':
          if (typeof val !== 'number' || Number.isNaN(val)) return `Setting "${field.label}" must be a number`;
          break;
        case 'boolean':
          if (typeof val !== 'boolean') return `Setting "${field.label}" must be a boolean`;
          break;
        case 'string':
        case 'password':
          if (typeof val !== 'string') return `Setting "${field.label}" must be a string`;
          break;
      }
    }
    return null;
  }

  private async getCachedSettings(pluginId: string): Promise<Record<string, unknown>> {
    const cached = this.settingsCache.get(pluginId);
    if (cached) return cached;

    const state = await prisma.pluginState.findUnique({ where: { pluginId } });
    const values = state ? JSON.parse(state.settings) : {};
    this.settingsCache.set(pluginId, values);
    return values;
  }

  private getContextDeps(): ContextFactoryDeps {
    return {
      logger: this.logger,
      getCachedSettings: (pluginId: string) => this.getCachedSettings(pluginId),
      setSettingsCache: (pluginId: string, values: Record<string, unknown>) => {
        this.settingsCache.set(pluginId, values);
      },
      makeFallbackLogger: (pluginId: string) => this.makeFallbackLogger(pluginId),
      signAuthToken: (payload) => {
        if (!this.app) throw new Error('Plugin engine not yet registered with Fastify — cannot issue auth tokens');
        return this.app.jwt.sign(payload, { expiresIn: '24h' });
      },
    };
  }

  private makeFallbackLogger(pluginId: string): FastifyBaseLogger {
    const prefix = `[Plugin:${pluginId}]`;
    const log = Object.assign((...args: unknown[]) => console.log(prefix, ...args), {
      info: (...args: unknown[]) => console.info(prefix, ...args),
      warn: (...args: unknown[]) => console.warn(prefix, ...args),
      error: (...args: unknown[]) => console.error(prefix, ...args),
      debug: (...args: unknown[]) => console.debug(prefix, ...args),
      fatal: (...args: unknown[]) => console.error(`${prefix}[FATAL]`, ...args),
      trace: (...args: unknown[]) => console.debug(`${prefix}[TRACE]`, ...args),
      silent: () => {},
      child: () => log,
      level: 'info',
    });
    return log as unknown as FastifyBaseLogger;
  }
}

export const pluginEngine = new PluginEngine();
