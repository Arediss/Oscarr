/** Plugin types that cross the wire between backend and frontend.
 *
 *  Runtime-side-only types (PluginManifest with FastifyBaseLogger refs, PluginContext,
 *  UIContribution as seen by the engine) stay in the backend — they reference Node/Fastify
 *  internals that don't belong in a pure-types shared package. Only the public contract
 *  shapes consumed by the frontend live here. */

/** A plugin's published UI contribution, enriched with its owning plugin's id by the engine
 *  before reaching the frontend. */
export interface PluginUIContribution {
  pluginId: string;
  hookPoint: string;
  props: Record<string, unknown>;
  order?: number;
  /** Changes when the plugin's frontend files change. The page appends it to every asset URL for
   *  that plugin, so a redeploy is not served from the browser cache for another hour. */
  assetVersion?: string;
}

/** Public plugin info as returned by `GET /api/plugins`. Consumed by the admin plugins tab,
 *  consent modals, the registry view, and the update banner. */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  hasSettings: boolean;
  hasFrontend: boolean;
  error?: string;
  compat?: {
    status: 'verified' | 'untested' | 'incompatible' | 'unknown';
    range?: string;
    oscarrVersion: string;
    reason?: string;
  };
  /** Populated by the backend from the update-check cache (GET /api/plugins/updates). */
  latestVersion?: string | null;
  lastUpdateCheck?: string | null;
  updateAvailable?: boolean;
  services?: string[];
  capabilities?: string[];
  capabilityReasons?: Partial<Record<string, string>>;

  // ── v0.8.0 — install source & update status ──
  /** How the plugin reached this Oscarr instance:
   *  - 'registry': installed via /install with a `repository` body — eligible for in-app
   *                updates and (eventually) auto-update.
   *  - 'local':    everything else (symlink dev install, raw URL install, manual drop-in).
   *                The admin manages updates themselves. */
  source?: 'registry' | 'local';
  /** True when `plugins/<id>/` is a symlink. Surfaced to the UI so dev installs are obvious. */
  isSymlink?: boolean;
  /** Per-plugin auto-update toggle. Off by default. Only effective when source === 'registry'. */
  autoUpdateEnabled?: boolean;
}

/** Pre-update preview returned by `GET /api/plugins/:id/update/preflight`. The admin sees
 *  this in the update modal: incompat blocks the apply button, added permissions trigger
 *  re-consent, removed/changed are shown for transparency. */
export interface PluginUpdatePreflight {
  currentVersion: string;
  latestVersion: string;
  compat: {
    status: 'verified' | 'untested' | 'incompatible' | 'unknown';
    range?: string;
    oscarrVersion: string;
    reason?: string;
  };
  permissionDiff: {
    services: { added: string[]; removed: string[] };
    capabilities: { added: string[]; removed: string[] };
    capabilityReasons: {
      added: Record<string, string>;
      removed: string[];
      changed: { capability: string; from: string; to: string }[];
    };
  };
}

/** A single plugin settings field as published in the manifest. Shown in the admin plugin
 *  settings form. Runtime handling of `type: 'password'` lives on the backend. */
export interface PluginSettingDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'password';
  required?: boolean;
  default?: unknown;
}

/** Snapshot of a plugin's settings (schema + current values) served by
 *  `GET /api/plugins/:id/settings`. */
export interface PluginSettings {
  schema: PluginSettingDef[];
  values: Record<string, unknown>;
}
