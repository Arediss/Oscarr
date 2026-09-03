import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A token that changes when a plugin's frontend files change.
 *
 * Plugin assets are served from a stable URL with a one-hour cache and no validator, so a
 * redeployed plugin kept serving the previous build to everyone who had already loaded it. The
 * page had a cache-busting query string, but only the browser that performed the install ever set
 * it — a deploy done anywhere else was invisible.
 *
 * Not the manifest version: a fork rebuilt in place keeps its version, and that is exactly the
 * case where a stale bundle is hardest to notice. File size and mtime move on every build.
 *
 * Computed once at load. The files cannot change underneath a running process without going
 * through a reload, which recomputes it.
 */
export function computeAssetVersion(pluginDir: string): string {
  const root = join(pluginDir, 'dist', 'frontend');
  const entries: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return; // No frontend at all: plugins are allowed to be backend-only.
    }
    for (const name of names) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full, `${prefix}${name}/`);
      else entries.push(`${prefix}${name}:${stat.size}:${stat.mtimeMs}`);
    }
  };
  walk(root, '');

  if (entries.length === 0) return '0';
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 12);
}
