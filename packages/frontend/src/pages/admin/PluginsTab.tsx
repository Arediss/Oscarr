import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { BookOpen, Download, Loader2, Package, Power, RefreshCw } from 'lucide-react';
import { Spinner } from './Spinner';
import { AdminTabLayout } from './AdminTabLayout';
import { PluginConsentModal } from './PluginConsentModal';
import { PluginUpdateModal } from './plugins/PluginUpdateModal';
import { usePluginsTab } from './plugins/usePluginsTab';
import { usePluginsDir } from '@/hooks/usePluginsDir';
import { InstalledList } from './plugins/InstalledList';
import { DiscoverList } from './plugins/DiscoverList';
import { PluginDocsModal } from './plugins/PluginDocsModal';
import type { PluginInfo } from '@/plugins/types';
import type { RegistryPlugin, SubTab } from './plugins/constants';

/**
 * Admin → Plugins. Two sub-tabs: Installed (local runtime list) and Discover (remote registry).
 * Install is a two-step flow: click → consent modal (shows the plugin's declared services and
 * capabilities) → confirm → actual tarball download.
 *
 * Data + mutations all live in `usePluginsTab`; lists and modals are their own components.
 */
export function PluginsTab() {
  const { t } = useTranslation();
  const {
    plugins, registry, loading, registryLoading, registryError,
    toggling, installing, uninstalling, updating, refreshing, restarting, installMessage,
    fetchRegistry, checkForUpdates, refreshUpdates,
    toggle, install, uninstall, applyUpdate, restart,
    setInstallMessage,
  } = usePluginsTab();

  const [searchParams, setSearchParams] = useSearchParams();
  const initialSub = searchParams.get('sub') === 'discover' ? 'discover' : 'installed';
  const [subTab, setSubTabState] = useState<SubTab>(initialSub);
  const setSubTab = (next: SubTab) => {
    setSubTabState(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'installed') params.delete('sub');
    else params.set('sub', next);
    setSearchParams(params, { replace: true });
  };
  const [showHowTo, setShowHowTo] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const pluginsDir = usePluginsDir();

  /** Consent-first install: click Install → modal shows services + capabilities →
   *  admin confirms → Oscarr actually downloads the tarball (disabled by default). */
  const [installConsent, setInstallConsent] = useState<RegistryPlugin | null>(null);
  /** Update flow target. The modal fetches its own preflight (compat + permission diff). */
  const [updateTarget, setUpdateTarget] = useState<PluginInfo | null>(null);

  useEffect(() => {
    if (subTab === 'discover' && registry.length === 0 && !registryLoading) {
      fetchRegistry();
    }
  }, [subTab, registry.length, registryLoading, fetchRegistry]);

  useEffect(() => { checkForUpdates(subTab); }, [subTab, checkForUpdates]);

  const handleInstall = (entry: RegistryPlugin) => {
    setInstallMessage(null);
    setInstallConsent(entry);
  };

  const doInstall = async (entry: RegistryPlugin) => {
    // On failure, keep the consent modal open so the admin sees the error banner still inside
    // the Discover context. Only a successful install closes the modal and flips the sub-tab.
    const ok = await install(entry);
    if (ok) {
      setInstallConsent(null);
      setSubTab('installed');
    }
  };

  const handleRestart = async () => {
    setShowRestartConfirm(false);
    await restart();
  };

  const handleUpdateConfirm = async () => {
    if (!updateTarget) return;
    const ok = await applyUpdate(updateTarget.id);
    if (ok) setUpdateTarget(null);
  };

  if (loading) return <Spinner />;

  const updatesAvailable = plugins.filter((p) => p.updateAvailable).length;
  const installedIds = new Set(plugins.map((p) => p.id));

  return (
    <AdminTabLayout>
      {/* Sub-tab selector + secondary actions share one row. Docs / Reload are pushed to the
          right via `ml-auto` so they don't compete visually with Installed/Discover. */}
      <div className="flex items-center gap-2 mb-6 border-b border-white/5 pb-3 flex-wrap">
        <button
          onClick={() => setSubTab('installed')}
          className={clsx(
            'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
            subTab === 'installed' ? 'bg-ndp-accent/10 text-ndp-accent' : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5',
          )}
        >
          <Package className="w-4 h-4" />
          Installed
          {plugins.length > 0 && (
            <span className={clsx('text-xs px-1.5 py-0.5 rounded-full', subTab === 'installed' ? 'bg-ndp-accent/15' : 'bg-white/10')}>
              {plugins.length}
            </span>
          )}
          {updatesAvailable > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-ndp-accent/80 text-white">
              {updatesAvailable} update{updatesAvailable > 1 ? 's' : ''}
            </span>
          )}
        </button>
        <button
          onClick={() => setSubTab('discover')}
          className={clsx(
            'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
            subTab === 'discover' ? 'bg-ndp-accent/10 text-ndp-accent' : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5',
          )}
        >
          <Download className="w-4 h-4" />
          Discover
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowHowTo(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors"
            title={t('admin.plugins.docs_title')}
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">{t('admin.plugins.docs')}</span>
          </button>
          <button
            onClick={refreshUpdates}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors disabled:opacity-50"
            title={t('admin.plugins.reload_title')}
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">{t('admin.plugins.reload')}</span>
          </button>
          <button
            onClick={() => setShowRestartConfirm(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors"
            title={t('admin.plugins.reboot_title', { dir: pluginsDir })}
          >
            <Power className="w-4 h-4" />
            <span className="hidden sm:inline">{t('admin.plugins.reboot')}</span>
          </button>
        </div>
      </div>

      {showRestartConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowRestartConfirm(false)}>
          <div className="card p-6 max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-ndp-text font-semibold mb-2">{t('admin.plugins.reboot_modal_title')}</h3>
            <p className="text-sm text-ndp-text-muted mb-4">
              {t('admin.plugins.reboot_modal_body_prefix')} <code className="text-ndp-text bg-black/30 px-1 py-0.5 rounded text-xs">{pluginsDir}</code>{t('admin.plugins.reboot_modal_body_suffix')}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowRestartConfirm(false)} className="px-4 py-2 text-sm text-ndp-text-dim hover:text-ndp-text transition-colors">
                {t('common.cancel')}
              </button>
              <button onClick={handleRestart} className="px-4 py-2 bg-ndp-accent text-white rounded-lg text-sm font-medium hover:bg-ndp-accent/90 transition-colors">
                {t('admin.plugins.reboot_modal_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {restarting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-ndp-accent" />
            <p className="text-ndp-text font-medium">{t('admin.plugins.rebooting')}</p>
            <p className="text-sm text-ndp-text-dim">{t('admin.plugins.rebooting_hint')}</p>
          </div>
        </div>
      )}

      {subTab === 'installed' && (
        <InstalledList
          plugins={plugins}
          registry={registry}
          toggling={toggling}
          uninstalling={uninstalling}
          updating={updating}
          onToggle={toggle}
          onUninstall={uninstall}
          onUpdate={setUpdateTarget}
          onBrowse={() => setSubTab('discover')}
        />
      )}

      {subTab === 'discover' && (
        <DiscoverList
          registry={registry}
          registryLoading={registryLoading}
          registryError={registryError}
          installedIds={installedIds}
          installing={installing}
          installMessage={installMessage}
          onRetry={fetchRegistry}
          onInstall={handleInstall}
          onManage={() => setSubTab('installed')}
        />
      )}

      <PluginConsentModal
        plugin={installConsent}
        open={!!installConsent}
        busy={installConsent ? installing === installConsent.id : false}
        mode="install"
        error={installMessage?.kind === 'error' ? installMessage.text : null}
        onCancel={() => { setInstallMessage(null); setInstallConsent(null); }}
        onConfirm={() => installConsent && doInstall(installConsent)}
      />

      <PluginUpdateModal
        plugin={updateTarget}
        open={!!updateTarget}
        busy={updateTarget ? updating === updateTarget.id : false}
        applyError={installMessage?.kind === 'error' ? installMessage.text : null}
        onCancel={() => { setInstallMessage(null); setUpdateTarget(null); }}
        onConfirm={handleUpdateConfirm}
      />

      {showHowTo && <PluginDocsModal onClose={() => setShowHowTo(false)} />}
    </AdminTabLayout>
  );
}
