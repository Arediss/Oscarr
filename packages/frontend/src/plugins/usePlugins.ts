import { useEffect, useState } from 'react';
import api from '../lib/api';
import type { PluginUIContribution } from './types';
import { adoptAssetVersion } from './pluginModuleCache';

const cache = new Map<string, { data: PluginUIContribution[]; fetchedAt: number }>();
const CACHE_TTL = 60_000;

// Per-hookPoint subscriber set. Cleared together with the cache so mounted hooks refetch
// after a toggle/install/uninstall instead of waiting for a full page reload.
const listeners = new Map<string, Set<() => void>>();

function notify(hookPoint?: string): void {
  if (hookPoint) {
    listeners.get(hookPoint)?.forEach((cb) => cb());
    return;
  }
  listeners.forEach((set) => set.forEach((cb) => cb()));
}

export function usePluginUI(hookPoint: string) {
  const cached = cache.get(hookPoint);
  const hasFreshOnMount = !!cached && Date.now() - cached.fetchedAt < CACHE_TTL;

  const [contributions, setContributions] = useState<PluginUIContribution[]>(hasFreshOnMount ? cached.data : []);
  const [loading, setLoading] = useState(!hasFreshOnMount);
  const [error, setError] = useState<string | null>(null);
  // Bumped on cache invalidation to force the fetch effect to re-run for every mounted hook.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const cb = () => setRevision((r) => r + 1);
    let set = listeners.get(hookPoint);
    if (!set) {
      set = new Set();
      listeners.set(hookPoint, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) listeners.delete(hookPoint);
    };
  }, [hookPoint]);

  useEffect(() => {
    // Re-check freshness inside the effect to avoid stale closure
    const entry = cache.get(hookPoint);
    if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) {
      setContributions(entry.data);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.get<PluginUIContribution[]>(`/plugins/ui/${hookPoint}`)
      .then((res) => {
        if (cancelled) return;
        // Do this before rendering: the hook components below build their import URLs from it, and
        // a contribution that arrives with a new token must not be loaded from the old one.
        for (const c of res.data) adoptAssetVersion(c.pluginId, c.assetVersion);
        cache.set(hookPoint, { data: res.data, fetchedAt: Date.now() });
        setContributions(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        setContributions([]);
        setError(err.message || 'Failed to load plugin contributions');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [hookPoint, revision]);

  return { contributions, loading, error };
}

/** Invalidate the UI contribution cache (e.g. after toggling a plugin). Notifies all
 *  mounted `usePluginUI` consumers so they refetch in place — no page reload needed. */
export function invalidatePluginUICache(hookPoint?: string): void {
  if (hookPoint) {
    cache.delete(hookPoint);
  } else {
    cache.clear();
  }
  notify(hookPoint);
}
