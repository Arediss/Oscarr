import type { ComponentType } from 'react';

interface CacheEntry {
  component: ComponentType<any> | null;
  loadedAt: number;
}

const cache = new Map<string, CacheEntry>();

const cssStyles = new Map<string, HTMLStyleElement>();

/** Per-plugin cache-busting token, bumped by `invalidate()`.
 *
 *  Clearing the Map above is not enough: `import()` and `fetch()` both go through the browser's
 *  own cache, keyed by URL. An updated, toggled or reinstalled plugin served from the same
 *  `/api/plugins/<id>/frontend/index.js` came back byte-identical from that cache, so the admin
 *  kept seeing the previous build until a hard refresh. A changing query string is a different
 *  URL, which is the only lever the page has here. */
const assetVersion = new Map<string, string>();

function versionedUrl(pluginId: string, path: string): string {
  const token = assetVersion.get(pluginId);
  return token ? `${path}?v=${token}` : path;
}

function bumpAssetVersion(pluginId: string): void {
  assetVersion.set(pluginId, Date.now().toString(36));
}

/** Attribute that plugin containers must carry — matches the scope prefix applied to their CSS. */
export const PLUGIN_SCOPE_ATTR = 'data-oscarr-plugin';

/** Extract the plugin id from a plugin asset URL. Both entry-point and hook-point URLs follow
 *  `/api/plugins/<pluginId>/frontend/...`, so the third path segment is the id. */
function pluginIdFromUrl(url: string): string | null {
  const match = url.match(/^\/api\/plugins\/([^/]+)\/frontend\//);
  return match ? (match[1] ?? null) : null;
}

/** Prefix every rule selector with the scope attribute. Skips keyframe step selectors and
 *  at-rule preludes.
 *
 *  The prelude of `@media (min-width:1024px)` is not a selector. Excluding `@` from the match
 *  did not skip those preludes — it merely started the match one character later, so the rule
 *  became `@<scope> media (min-width:1024px){`: an invalid at-rule that browsers drop along with
 *  everything inside it. Every responsive utility and every plugin @keyframes silently died. */
export function scopePluginCss(css: string, scope: string): string {
  return css.replaceAll(/([^{}]+)\{/g, (match, selectorList: string) => {
    const trimmed = selectorList.trim();
    if (!trimmed) return match;
    // Leave the at-rule itself alone; its inner rules are scoped by later iterations.
    if (trimmed.startsWith('@')) return match;
    const parts = splitSelectorList(trimmed);
    if (parts.length === 0) return match;
    if (parts.every((part) => /^(\d+(\.\d+)?%|from|to)$/.test(part))) return match;
    return `${parts.map((part) => `${scope} ${part}`).join(',')}{`;
  });
}

/** Split a selector list on its top-level commas only.
 *
 *  A plain `.split(',')` cuts inside functional pseudo-classes and attribute values:
 *  `.card:is(.compact,.wide)` came out as `<scope> .card:is(.compact` + `<scope> .wide)`, which
 *  is both invalid and silently different from what the plugin author wrote. Depth counting over
 *  `()` / `[]` — and skipping quoted strings — keeps those commas where they belong.
 *
 *  Still regex-driven at the rule level, so a `{` inside a declaration string (`content: "{"`)
 *  would confuse the outer pass. Plugin bundles are Tailwind output in practice; a real CSS
 *  parser is the fix if that ever stops being true. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) {
      if (ch === quote && list[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Fetch + scope + inject the plugin's compiled CSS bundle. One-shot per pluginId. */
async function ensurePluginCss(pluginId: string): Promise<void> {
  if (cssStyles.has(pluginId)) return;
  const existing = Array.from(document.head.querySelectorAll<HTMLStyleElement>('style[data-plugin-id]'))
    .find((el) => el.dataset.pluginId === pluginId);
  if (existing) {
    cssStyles.set(pluginId, existing);
    return;
  }

  try {
    const res = await fetch(versionedUrl(pluginId, `/api/plugins/${pluginId}/frontend/index.css`));
    if (!res.ok) {
      if (import.meta.env.DEV && res.status === 404) {
        console.warn(
          `Plugin "${pluginId}" did not ship a CSS bundle. Run \`npm run plugin:add-tailwind -- <plugin-dir>\` to enable Tailwind in the plugin.`,
        );
      }
      return;
    }
    const raw = await res.text();
    const scoped = scopePluginCss(raw, `[${PLUGIN_SCOPE_ATTR}="${CSS.escape(pluginId)}"]`);
    const style = document.createElement('style');
    style.dataset.pluginId = pluginId;
    style.textContent = scoped;
    document.head.appendChild(style);
    cssStyles.set(pluginId, style);
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Failed to inject CSS for plugin', pluginId, err);
  }
}

function removePluginCss(pluginId: string): void {
  const style = cssStyles.get(pluginId);
  if (!style) return;
  style.remove();
  cssStyles.delete(pluginId);
}

/** Load a plugin ESM module from a URL. Returns the default export as a React component.
 *  Also injects the plugin's compiled CSS bundle on first successful load — the core bundle
 *  no longer purges classes it doesn't use itself, so plugins ship their own utilities. */
export async function loadPluginModule(url: string): Promise<ComponentType<any> | null> {
  const cached = cache.get(url);
  if (cached) return cached.component;

  try {
    const mod = await import(/* @vite-ignore */ url);
    const component = mod.default || null;
    const pluginId = pluginIdFromUrl(url);
    if (pluginId) ensurePluginCss(pluginId);
    cache.set(url, { component, loadedAt: Date.now() });
    return component;
  } catch (err) {
    // Don't cache failures — allow retry on next call. Log in dev so a bundle eval crash /
    // CSP block / syntax error doesn't silently render the plugin as missing.
    if (import.meta.env.DEV) console.error(`Failed to load plugin module at ${url}`, err);
    return null;
  }
}

/** Check if a URL has been loaded (hit or miss). */
export function hasLoaded(url: string): boolean {
  return cache.has(url);
}

/** Get a previously loaded component (or null). */
export function getCached(url: string): ComponentType<any> | null {
  return cache.get(url)?.component ?? null;
}

/** Invalidate cache for a specific plugin (by pluginId prefix) or all entries. Also tears down
 *  the plugin's injected CSS so a disabled plugin can't keep styling the app. */
export function invalidate(pluginId?: string): void {
  if (!pluginId) {
    cache.clear();
    for (const id of Array.from(cssStyles.keys())) {
      removePluginCss(id);
      bumpAssetVersion(id);
    }
    for (const id of Array.from(assetVersion.keys())) bumpAssetVersion(id);
    return;
  }
  const prefix = `/api/plugins/${pluginId}/`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  removePluginCss(pluginId);
  bumpAssetVersion(pluginId);
}

/** Build the standard URL for a plugin's main frontend module. */
export function pluginFrontendUrl(pluginId: string): string {
  return versionedUrl(pluginId, `/api/plugins/${pluginId}/frontend/index.js`);
}

/** Build the standard URL for a plugin's hook component. */
export function pluginHookUrl(pluginId: string, hookPoint: string): string {
  return versionedUrl(pluginId, `/api/plugins/${pluginId}/frontend/hooks/${hookPoint}.js`);
}
