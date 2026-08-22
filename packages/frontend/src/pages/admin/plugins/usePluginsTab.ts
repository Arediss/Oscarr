import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { toastApiError, extractApiError } from '@/utils/toast';
import { invalidatePluginUICache } from '@/plugins/usePlugins';
import { refreshPluginUpdatesCount } from '@/hooks/usePluginUpdatesCount';
import type { PluginInfo } from '@/plugins/types';
import type { RegistryPlugin, SubTab } from './constants';

export interface InstallMessage {
  kind: 'success' | 'error';
  text: string;
  /** Offers the jump to Installed. Set after an install, where the plugin is deliberately left
   *  off until the admin has reviewed its permissions — testers read that silence as a bug. */
  showManage?: boolean;
}

/**
 * Owns all plugin-page data + mutations: installed list, remote registry, toggle/install/
 * uninstall flows, one-shot update-check probe on the Installed tab, and the Reload-Oscarr
 * restart poller. UI consumes the returned state + handlers and stays presentational.
 */
export function usePluginsTab() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [installMessage, setInstallMessage] = useState<InstallMessage | null>(null);

  const fetchPlugins = useCallback(() => {
    return api.get('/plugins')
      .then(({ data }) => setPlugins(data))
      .catch((err) => toastApiError(err, t('admin.plugins.load_failed')))
      .finally(() => setLoading(false));
  }, [t]);

  const fetchRegistry = useCallback((force = false) => {
    setRegistryLoading(true);
    setRegistryError(null);
    return api.get('/plugins/registry', { params: force ? { force: 'true' } : undefined })
      .then(({ data }) => setRegistry(data))
      .catch(() => setRegistryError('Failed to load plugin registry'))
      .finally(() => setRegistryLoading(false));
  }, []);

  useEffect(() => { fetchPlugins(); }, [fetchPlugins]);

  /** Kick an update-check once when the Installed tab first becomes visible so the
   *  `latestVersion` badges can populate without user action. Backend has a 15 min cache, so
   *  this is a cheap no-op on subsequent mounts. */
  const updateCheckedRef = useRef(false);
  const checkForUpdates = useCallback((subTab: SubTab) => {
    if (subTab !== 'installed' || updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    api.get('/plugins/updates').then(() => fetchPlugins()).catch(() => { /* best-effort */ });
  }, [fetchPlugins]);

  /** Force-refresh: bypass the 15 min TTL + per-repo release cache. Wired to the Reload button.
   *  Also force-refreshes the Discover catalog so new registry entries (or new releases of
   *  already-listed plugins) show up immediately instead of waiting for the 30 min TTL. */
  const refreshUpdates = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        api.get('/plugins/updates', { params: { force: 'true' } }),
        fetchRegistry(true),
      ]);
      await fetchPlugins();
      refreshPluginUpdatesCount();
    } catch (err) {
      toastApiError(err, t('admin.plugins.refresh_failed'));
    } finally {
      setRefreshing(false);
    }
  }, [fetchPlugins, fetchRegistry, t]);

  const applyUpdate = useCallback(async (id: string): Promise<boolean> => {
    setUpdating(id);
    try {
      const { data } = await api.post(`/plugins/${id}/update`);
      setInstallMessage({ kind: 'success', text: `Updated to v${data.plugin.version}` });
      await fetchPlugins();
      invalidatePluginUICache();
      refreshPluginUpdatesCount();
      // Longer than the old 6s: this one asks the admin to go and do something.
      setTimeout(() => setInstallMessage(null), 12000);
      return true;
    } catch (err) {
      setInstallMessage({ kind: 'error', text: extractApiError(err, String((err as Error).message)) });
      return false;
    } finally {
      setUpdating(null);
    }
  }, [fetchPlugins]);

  const toggle = useCallback(async (plugin: PluginInfo) => {
    setToggling(plugin.id);
    try {
      await api.put(`/plugins/${plugin.id}/toggle`, { enabled: !plugin.enabled });
      setPlugins((prev) => prev.map((p) => (p.id === plugin.id ? { ...p, enabled: !plugin.enabled } : p)));
      invalidatePluginUICache();
    } catch (err) {
      toastApiError(err, t('admin.plugins.toggle_failed', { name: plugin.name }));
    } finally {
      setToggling(null);
    }
  }, [t]);

  const install = useCallback(async (entry: RegistryPlugin): Promise<boolean> => {
    setInstalling(entry.id);
    try {
      // Pass the repo slug — backend resolves to a Release asset URL via the GitHub API.
      // Keeps api.github.com out of the frontend's connect-src CSP.
      const { data } = await api.post('/plugins/install', { repository: entry.repository });
      setInstallMessage({
        kind: 'success',
        text: t('admin.plugins.installed_disabled', { name: data.plugin.name, version: data.plugin.version }),
        showManage: true,
      });
      // Fire-and-forget so the caller can unmount the consent modal immediately; the refetch
      // populates the Installed tab in the background before the admin flips to it.
      fetchPlugins();
      refreshPluginUpdatesCount();
      // Only the success banner self-dismisses. A failure stays until the admin dismisses the
      // dialog — install errors are long and actionable, and 6s is not enough to read one.
      // Longer than the old 6s: this one asks the admin to go and do something.
      setTimeout(() => setInstallMessage(null), 12000);
      return true;
    } catch (err) {
      setInstallMessage({ kind: 'error', text: extractApiError(err, String((err as Error).message)) });
      return false;
    } finally {
      setInstalling(null);
    }
  }, [fetchPlugins]);

  const uninstall = useCallback(async (id: string) => {
    setUninstalling(id);
    try {
      await api.post(`/plugins/${id}/uninstall`);
      await fetchPlugins();
      invalidatePluginUICache();
      refreshPluginUpdatesCount();
    } catch (err) {
      setInstallMessage({ kind: 'error', text: `Uninstall failed: ${extractApiError(err, String((err as Error).message))}` });
      // Longer than the old 6s: this one asks the admin to go and do something.
      setTimeout(() => setInstallMessage(null), 12000);
    } finally {
      setUninstalling(null);
    }
  }, [fetchPlugins]);

  const restart = useCallback(async () => {
    setRestarting(true);
    try {
      await api.post('/admin/restart', { confirm: 'RESTART' });
    } catch { /* server is shutting down, expected */ }

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        await api.get('/app/features');
        globalThis.location.reload();
        return;
      } catch { /* still down */ }
    }
    setRestarting(false);
    alert('Server did not come back after 30 seconds. Check the logs.');
  }, []);

  return {
    plugins, registry, loading, registryLoading, registryError,
    toggling, installing, uninstalling, updating, refreshing, restarting, installMessage,
    fetchPlugins, fetchRegistry, checkForUpdates, refreshUpdates,
    toggle, install, uninstall, applyUpdate, restart,
    setInstallMessage,
  };
}
