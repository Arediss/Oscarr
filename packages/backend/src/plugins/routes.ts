import type { FastifyInstance } from 'fastify';
import { join, extname, resolve, sep, relative } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { pluginEngine } from './engine.js';
import { getPluginsDir } from './loader.js';
import { installPluginFromUrl } from './installer.js';
import { prisma } from '../utils/prisma.js';
import { scrubSecrets } from '../utils/logScrubber.js';
import { buildRuntimeStatus } from './statusDetection.js';
import { checkCompat } from './compat.js';
import { parseManifest } from './manifestSchema.js';
import type { PluginManifest, LoadedPlugin } from './types.js';
import type { FastifyRequest } from 'fastify';
import {
  fetchRegistry,
  fetchLatestRelease,
  fetchRepoMetadata,
  fetchRemoteManifest,
  resolveInstallUrl,
  checkUpdatesForRegistryPlugins,
  type RegistryEntry,
  type UpdateCheckResult,
} from './registry.js';

// ── Discover catalog cache ──────────────────────────────────────────
// The catalog is the UI-shaped projection (manifest + repo metadata + downloads) returned
// by GET /registry. The raw registry doc + per-repo release calls are cached inside
// registry.ts; this cache only memoizes the final UI shape so we don't re-stitch it on
// every Discover open.
const CATALOG_TTL_MS = 30 * 60 * 1000;
let catalogCache: { data: unknown; timestamp: number } | null = null;

// ── Update check cache ──────────────────────────────────────────────
// Module-scope so the badge survives a tab refresh without re-hammering GitHub. 15 min is
// tight enough for the admin "updates available" dot to feel live but loose enough to keep
// us under GitHub's 60 req/h unauthenticated limit. The Reload button bypasses both this
// cache and the per-repo release cache via `force: true`.
const UPDATE_TTL_MS = 15 * 60 * 1000;
let updateCache: { data: Record<string, UpdateCheckResult>; timestamp: number } | null = null;

async function getOrComputeUpdates(force = false): Promise<Record<string, UpdateCheckResult>> {
  const now = Date.now();
  if (!force && updateCache && now - updateCache.timestamp < UPDATE_TTL_MS) return updateCache.data;

  // Only registry-installed plugins are tracked. Local plugins (symlinks, URL installs,
  // manual drop-ins) are excluded — admin manages those themselves.
  const states = await prisma.pluginState.findMany({
    where: { installSource: 'registry', repository: { not: null } },
    select: { pluginId: true, repository: true },
  });
  const installed = pluginEngine.getPluginList();
  const inputs = states
    .map((s) => {
      const p = installed.find((i) => i.id === s.pluginId);
      if (!p || !s.repository) return null;
      return { id: p.id, repository: s.repository, version: p.version };
    })
    .filter((x): x is { id: string; repository: string; version: string } => x !== null);

  const batch = await checkUpdatesForRegistryPlugins(inputs, { force });

  // Skip null latest — a per-plugin failure mustn't overwrite a previously good value.
  const checkedAt = new Date();
  await Promise.all(
    Array.from(batch.results).flatMap(([pluginId, r]) =>
      r.latest === null ? [] : [
        prisma.pluginState.update({
          where: { pluginId },
          data: { latestVersion: r.latest, lastUpdateCheck: checkedAt },
        }).catch(() => { /* row may have been removed mid-check; ignore */ }),
      ],
    ),
  );

  const result: Record<string, UpdateCheckResult> = {};
  for (const [id, r] of batch.results) result[id] = r;
  if (batch.ok) updateCache = { data: result, timestamp: now };
  return result;
}

/** Shared install pipeline: download → extract → loadSingle → persist installSource. Throws on
 *  any failure with the install dir already cleaned up. Used by both POST /install and
 *  POST /:id/update so the two paths can't drift. */
async function performInstall(
  url: string,
  repository: string | null,
  request: FastifyRequest,
): Promise<LoadedPlugin> {
  let installedDir: string | null = null;
  try {
    const installed = await installPluginFromUrl(url);
    installedDir = installed.dir;
    const loaded = await pluginEngine.loadSingle(installed.dir, { defaultEnabled: false });

    await prisma.pluginState.update({
      where: { pluginId: loaded.manifest.id },
      data: repository
        ? { installSource: 'registry', repository }
        : { installSource: 'local', repository: null },
    }).catch((err) => {
      request.log.warn({ err, pluginId: loaded.manifest.id }, '[plugins] Failed to persist installSource');
    });

    updateCache = null;

    const jobDefs = loaded.manifest.hooks?.jobs ?? [];
    if (jobDefs.length > 0) {
      const { registerPluginJobs } = await import('../services/scheduler.js');
      await registerPluginJobs(jobDefs, loaded.manifest.id);
    }
    return loaded;
  } catch (err) {
    if (installedDir) {
      await rm(installedDir, { recursive: true, force: true }).catch((rmErr) => {
        request.log.error({ err: rmErr, dir: installedDir }, '[plugins] Rollback failed to remove install dir');
      });
    }
    throw err;
  }
}

/** Compares the permission surface of two manifests. Drives the update consent modal:
 *  added items trigger re-consent, removed/changed are shown for transparency. */
function diffPermissions(prev: PluginManifest, next: PluginManifest) {
  const diffArray = (a: string[] = [], b: string[] = []) => ({
    added: b.filter((x) => !a.includes(x)),
    removed: a.filter((x) => !b.includes(x)),
  });
  const prevReasons = (prev.capabilityReasons ?? {}) as Record<string, string>;
  const nextReasons = (next.capabilityReasons ?? {}) as Record<string, string>;
  const reasonAdded: Record<string, string> = {};
  const reasonChanged: { capability: string; from: string; to: string }[] = [];
  for (const [cap, reason] of Object.entries(nextReasons)) {
    if (!(cap in prevReasons)) reasonAdded[cap] = reason;
    else if (prevReasons[cap] !== reason) reasonChanged.push({ capability: cap, from: prevReasons[cap], to: reason });
  }
  const reasonRemoved = Object.keys(prevReasons).filter((cap) => !(cap in nextReasons));
  return {
    services: diffArray(prev.services, next.services),
    capabilities: diffArray(prev.capabilities, next.capabilities),
    capabilityReasons: { added: reasonAdded, removed: reasonRemoved, changed: reasonChanged },
  };
}

// Allowed file extensions for plugin frontend serving
const ALLOWED_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.json', '.map', '.svg']);

export async function pluginRoutes(app: FastifyInstance) {

  // ── Resolved plugins directory ──────────────────────────────────
  // Surfaces the absolute path the engine actually reads from — respects OSCARR_PLUGINS_DIR
  // and falls back to <project-root>/plugins otherwise. UI uses this to show the correct
  // hint instead of hardcoding `packages/plugins/` (wrong on Docker + self-hosted layouts).
  app.get('/dir', async () => {
    return { dir: getPluginsDir() };
  });

  // ── List installed plugins ──────────────────────────────────────
  // Joins the engine's in-memory plugin list with PluginState to compute the runtime status
  // (source, latestVersion, updateAvailable, autoUpdateEnabled). No registry fetch on this
  // path — `latestVersion` is whatever was persisted by the last /updates call. The Discover
  // endpoint (GET /registry) and /updates are the only paths that hit GitHub.
  app.get('/', async () => {
    const list = pluginEngine.getPluginList();
    if (list.length === 0) return list;

    const states = await prisma.pluginState.findMany({
      where: { pluginId: { in: list.map((p) => p.id) } },
      select: {
        pluginId: true,
        latestVersion: true,
        lastUpdateCheck: true,
        installSource: true,
        autoUpdateEnabled: true,
      },
    });
    const byId = new Map(states.map((s) => [s.pluginId, s]));

    return list.map((p) => {
      const s = byId.get(p.id);
      const loaded = pluginEngine.getPlugin(p.id);
      const runtime = loaded
        ? buildRuntimeStatus(loaded, {
            latestVersion: s?.latestVersion ?? null,
            pluginState: s ? { installSource: s.installSource, autoUpdateEnabled: s.autoUpdateEnabled } : null,
          })
        : null;
      return {
        ...p,
        latestVersion: runtime?.latestVersion ?? null,
        lastUpdateCheck: s?.lastUpdateCheck?.toISOString() ?? null,
        updateAvailable: runtime?.updateAvailable ?? false,
        source: runtime?.source ?? 'local',
        isSymlink: runtime?.isSymlink ?? p.isSymlink === true,
        autoUpdateEnabled: runtime?.autoUpdateEnabled ?? false,
      };
    });
  });

  // ── Check for updates ────────────────────────────────────────────
  // `?force=true` bypasses the 15 min TTL cache + the per-repo release cache.
  app.get<{ Querystring: { force?: string } }>('/updates', async (request) => {
    return getOrComputeUpdates(request.query.force === 'true');
  });

  // ── Update preflight ────────────────────────────────────────────
  // Powers the update modal: returns compat + permission diff between the loaded manifest
  // and the latest release's manifest. We fetch the manifest at the release tag (not main)
  // so the diff matches what /install will actually apply. Refuses with 502 when the tagged
  // manifest can't be fetched — better than silently letting permissions change.
  app.get<{ Params: { id: string } }>(
    '/:id/update/preflight',
    {
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    },
    async (request, reply) => {
      const { id } = request.params;
      const plugin = pluginEngine.getPlugin(id);
      if (!plugin) return reply.status(404).send({ error: 'Plugin not found' });

      const state = await prisma.pluginState.findUnique({
        where: { pluginId: id },
        select: { installSource: true, repository: true },
      });
      if (state?.installSource !== 'registry' || !state.repository) {
        return reply.status(400).send({ error: 'Plugin is not a registry install' });
      }

      const rel = await fetchLatestRelease(state.repository).catch(() => null);
      const tag = rel?.tag_name;
      const latestVersion = tag ? tag.replace(/^v/i, '') : null;
      if (!latestVersion || latestVersion === plugin.manifest.version) {
        return reply.status(400).send({ error: 'No update available' });
      }

      const remote = await fetchRemoteManifest(state.repository, tag!);
      if (!remote) {
        return reply.status(502).send({ error: "Couldn't verify the new manifest's permissions" });
      }
      let nextManifest: PluginManifest;
      try {
        nextManifest = parseManifest(remote, `${state.repository}@${tag}`) as PluginManifest;
      } catch (err) {
        return reply.status(502).send({ error: `Invalid manifest in ${tag}: ${(err as Error).message}` });
      }

      return {
        currentVersion: plugin.manifest.version,
        latestVersion,
        compat: checkCompat(nextManifest),
        permissionDiff: diffPermissions(plugin.manifest, nextManifest),
      };
    }
  );

  // ── Install plugin from URL or registry repository ──────────────
  // Two install modes:
  //   - `repository`: registry install — resolves the latest release tarball, persists
  //                   `installSource='registry'` + the repository so /updates can track it.
  //   - `url`:        raw URL install (legacy / dev) — persists `installSource='local'`,
  //                   the admin manages updates themselves.
  app.post<{ Body: { url?: string; repository?: string } }>(
    '/install',
    {
      bodyLimit: 8 * 1024,
      // Each install triggers an outbound HTTP fetch + tarball extraction, which is the
      // most expensive operation in this router. 5/min is plenty for a real admin and tight
      // enough to defang accidental script-loops or abuse if an admin token leaks.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', minLength: 1, maxLength: 500 },
            repository: { type: 'string', pattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', maxLength: 200 },
          },
          anyOf: [{ required: ['url'] }, { required: ['repository'] }],
        },
      },
    },
    async (request, reply) => {
      const { url: explicitUrl, repository } = request.body;
      try {
        const url = repository ? await resolveInstallUrl(repository) : explicitUrl!;
        const loaded = await performInstall(url, repository ?? null, request);
        return {
          ok: true,
          plugin: {
            id: loaded.manifest.id,
            name: loaded.manifest.name,
            version: loaded.manifest.version,
            enabled: loaded.enabled,
            error: loaded.error,
          },
        };
      } catch (err) {
        const source = repository ? { repository } : { url: scrubSecrets(explicitUrl ?? '') };
        request.log.error({ err, ...source }, '[plugins] Install failed');
        return reply.status(400).send({ error: String((err as Error).message ?? err) });
      }
    }
  );

  // ── Update plugin ───────────────────────────────────────────────
  // Uninstall the running version, then install the latest release of the same registry
  // repository. Settings + installSource + repository + autoUpdateEnabled survive (uninstall
  // only flips `enabled=false`, doesn't delete the row). If the plugin was enabled, we flip
  // it back on after the new version loads. If install fails mid-flight, the plugin is gone
  // and the admin must reinstall from Discover — by design, no stale-version rollback.
  app.post<{ Params: { id: string } }>(
    '/:id/update',
    {
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { id } = request.params;
      const plugin = pluginEngine.getPlugin(id);
      if (!plugin) return reply.status(404).send({ error: 'Plugin not found' });

      const state = await prisma.pluginState.findUnique({
        where: { pluginId: id },
        select: { installSource: true, repository: true },
      });
      if (state?.installSource !== 'registry' || !state.repository) {
        return reply.status(400).send({ error: 'Plugin is not a registry install' });
      }

      const wasEnabled = plugin.enabled;
      const repository = state.repository;
      try {
        // Resolve the URL BEFORE uninstalling so a network blip on resolve leaves the running
        // plugin intact. Past the uninstall point, a failure leaves the plugin gone.
        const url = await resolveInstallUrl(repository);
        await pluginEngine.uninstall(id);
        const loaded = await performInstall(url, repository, request);
        if (wasEnabled) await pluginEngine.togglePlugin(loaded.manifest.id, true);
        return {
          ok: true,
          plugin: {
            id: loaded.manifest.id,
            name: loaded.manifest.name,
            version: loaded.manifest.version,
            enabled: wasEnabled,
          },
        };
      } catch (err) {
        request.log.error({ err, id, repository }, '[plugins] Update failed');
        return reply.status(400).send({ error: String((err as Error).message ?? err) });
      }
    }
  );

  // ── Uninstall plugin ────────────────────────────────────────────
  // Drops the plugin's router entry in the dispatcher map, pauses jobs, removes the dir —
  // no restart needed. The module itself stays in Node's ESM loader cache until process exit,
  // but the routes, ctx, and capability surface are all gone.
  app.post<{ Params: { id: string } }>(
    '/:id/uninstall',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const removed = await pluginEngine.uninstall(id);
        if (!removed) return reply.status(404).send({ error: `Plugin "${id}" not found` });
        updateCache = null;
        return { ok: true };
      } catch (err) {
        request.log.error({ err, id }, '[plugins] Uninstall failed');
        return reply.status(500).send({ error: String((err as Error).message ?? err) });
      }
    }
  );

  // ── Toggle plugin ───────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/:id/toggle',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { enabled } = request.body;
      try {
        await pluginEngine.togglePlugin(id, enabled);
        return { success: true };
      } catch (err) {
        return reply.status(404).send({ error: String(err) });
      }
    }
  );

  // ── Get settings ────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id/settings',
    {
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    },
    async (request, reply) => {
      try {
        return await pluginEngine.getSettings(request.params.id);
      } catch (err) {
        return reply.status(404).send({ error: String(err) });
      }
    }
  );

  // ── Update settings ─────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id/settings',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        body: { type: 'object', additionalProperties: true },
      },
    },
    async (request, reply) => {
      try {
        await pluginEngine.updateSettings(request.params.id, request.body);
        return { success: true };
      } catch (err) {
        return reply.status(404).send({ error: String(err) });
      }
    }
  );

  // ── UI contributions ────────────────────────────────────────────
  app.get<{ Params: { hookPoint: string } }>(
    '/ui/:hookPoint',
    {
      schema: { params: { type: 'object', required: ['hookPoint'], properties: { hookPoint: { type: 'string' } } } },
    },
    async (request) => {
      return pluginEngine.getUIContributions(request.params.hookPoint);
    }
  );

  // ── Feature flags ───────────────────────────────────────────────
  app.get('/features', async () => {
    return pluginEngine.getAllFeatureFlags();
  });

  // ── Plugin frontend files ───────────────────────────────────────
  app.get('/:id/frontend/*', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = (request.params as Record<string, string>)['*'];
    const plugin = pluginEngine.getPlugin(id);
    if (!plugin || !plugin.enabled || plugin.error) {
      return reply.status(404).send({ error: 'Plugin not found' });
    }

    const safePath = (filePath || '').replace(/^\//, '');
    if (!safePath) return reply.status(400).send({ error: 'File path required' });

    // Extension whitelist
    const ext = extname(safePath);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.status(403).send({ error: 'File type not allowed' });
    }

    const fullPath = resolve(join(plugin.dir, 'dist', 'frontend', safePath));

    // Path traversal check using relative path
    const frontendRoot = resolve(plugin.dir, 'dist', 'frontend');
    const rel = relative(frontendRoot, fullPath);
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
      return reply.status(403).send({ error: 'Access denied' });
    }

    if (!existsSync(fullPath)) {
      return reply.status(404).send({ error: 'File not found' });
    }

    const contentTypes: Record<string, string> = {
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.map': 'application/json',
    };
    reply.header('content-type', contentTypes[ext] || 'text/plain');
    reply.header('cache-control', process.env.NODE_ENV === 'production' ? 'public, max-age=3600' : 'no-cache');
    return reply.send(createReadStream(fullPath));
  });

  // ── Plugin logs ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id/logs',
    {
      schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { limit = '100' } = request.query as Record<string, string>;
      const plugin = pluginEngine.getPlugin(id);
      if (!plugin) return reply.status(404).send({ error: 'Plugin not found' });

      const logs = await prisma.pluginLog.findMany({
        where: { pluginId: id },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number.parseInt(limit, 10) || 100, 500),
      });
      return logs;
    }
  );

  // ── Plugin registry (Discover) ──────────────────────────────────
  // Stitches the registry doc (curated list) with each entry's manifest + GitHub repo
  // metadata + release download counts to produce the catalog the admin sees on the
  // Discover tab. Cached 30 min — same TTL as the registry doc itself.
  app.get<{ Querystring: { force?: string } }>('/registry', async (request, reply) => {
    try {
      const force = request.query.force === 'true';
      const now = Date.now();
      if (!force && catalogCache && now - catalogCache.timestamp < CATALOG_TTL_MS) {
        return catalogCache.data;
      }

      const registry = await fetchRegistry(force);
      const validRepo = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
      const validEntries = (registry.plugins ?? []).filter((entry: RegistryEntry) => {
        if (!validRepo.test(entry.repository)) {
          request.log.warn({ repository: entry.repository }, '[Registry] Skipping invalid repository');
          return false;
        }
        return true;
      });

      const catalog = await Promise.allSettled(
        validEntries.map(async (entry) => {
          const manifest = await fetchRemoteManifest(entry.repository);
          if (!manifest) return null;
          const repoMeta = await fetchRepoMetadata(entry.repository);

          let downloads = 0;
          try {
            const rel = await fetchLatestRelease(entry.repository, force);
            for (const a of rel?.assets ?? []) {
              if (/\.tar\.gz$/i.test(a.name) && !/\.sha256$/i.test(a.name)) {
                downloads += a.download_count ?? 0;
              }
            }
          } catch { /* ignore — downloads stay at 0 */ }

          return {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            description: manifest.description || repoMeta.description || '',
            author: manifest.author || '',
            repository: entry.repository,
            category: entry.category || 'utilities',
            tags: Array.isArray(entry.tags) ? entry.tags.filter((t): t is string => typeof t === 'string') : [],
            url: `https://github.com/${entry.repository}`,
            stars: repoMeta.stargazers_count ?? 0,
            downloads,
            updatedAt: repoMeta.pushed_at || null,
            // Compat status computed server-side against the running Oscarr version so the
            // admin sees the badge + a disabled Install button before downloading anything.
            // Avoids the "download → loadSingle throws on incompat → cryptic error toast" loop.
            compat: checkCompat(manifest as unknown as PluginManifest),
            // Permission surface the plugin will request — surfaced pre-install so the admin can
            // review what they're about to grant before Oscarr downloads any code.
            services: Array.isArray(manifest.services) ? manifest.services : undefined,
            capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : undefined,
            capabilityReasons: (manifest.capabilityReasons && typeof manifest.capabilityReasons === 'object')
              ? manifest.capabilityReasons
              : undefined,
          };
        })
      );

      const result = catalog
        .flatMap((p) => (p.status === 'fulfilled' && p.value !== null ? [p.value] : []));

      catalogCache = { data: result, timestamp: now };
      return result;
    } catch (err) {
      request.log.warn({ err }, '[Registry] Catalog fetch failed');
      return reply.status(502).send({ error: 'Failed to fetch plugin registry' });
    }
  });
}
