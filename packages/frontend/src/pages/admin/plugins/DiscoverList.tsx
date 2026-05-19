import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { AlertTriangle, Check, Download, Eye, EyeOff, ExternalLink, Loader2, Package, Search, Sparkles, Star, X } from 'lucide-react';
import { PluginInitial } from './PluginCardChrome';
import { CATEGORY_CONFIG, TAG_CONFIG, type RegistryPlugin } from './constants';
import type { InstallMessage } from './usePluginsTab';

/** A plugin counts as "new" when its latest release published within this window. */
const NEW_WINDOW_DAYS = 14;
const NEW_WINDOW_MS = NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function isNewPlugin(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const ts = new Date(updatedAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts < NEW_WINDOW_MS;
}

interface DiscoverListProps {
  registry: RegistryPlugin[];
  registryLoading: boolean;
  registryError: string | null;
  installedIds: Set<string>;
  installing: string | null;
  installMessage: InstallMessage | null;
  onRetry: () => void;
  onInstall: (entry: RegistryPlugin) => void;
  onManage: () => void;
}

/** Discover grid — browse the GitHub plugin registry, install with a click (consent happens in
 *  the parent through PluginConsentModal). */
export function DiscoverList({
  registry, registryLoading, registryError, installedIds,
  installing, installMessage, onRetry, onInstall, onManage,
}: DiscoverListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [hideInstalled, setHideInstalled] = useState(true);
  const [showNewOnly, setShowNewOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return registry.filter((p) => {
      if (hideInstalled && installedIds.has(p.id)) return false;
      if (showNewOnly && !isNewPlugin(p.updatedAt)) return false;
      if (q) {
        const haystack = [
          p.name,
          p.description,
          p.author,
          p.category,
          CATEGORY_CONFIG[p.category]?.label ?? '',
          ...(p.tags ?? []),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [registry, query, hideInstalled, showNewOnly, installedIds]);

  const { newPlugins, restPlugins } = useMemo(() => {
    const news: RegistryPlugin[] = [];
    const rest: RegistryPlugin[] = [];
    for (const p of filtered) {
      if (isNewPlugin(p.updatedAt)) news.push(p);
      else rest.push(p);
    }
    return { newPlugins: news, restPlugins: rest };
  }, [filtered]);

  return (
    <div className="space-y-5">
      {installMessage && (
        <div
          className={clsx(
            'card px-4 py-3 text-sm flex items-center gap-3',
            installMessage.kind === 'success' && 'border-ndp-success/30 text-ndp-success',
            installMessage.kind === 'error' && 'border-ndp-error/30 text-ndp-error',
          )}
        >
          {installMessage.kind === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span>{installMessage.text}</span>
        </div>
      )}

      {registryLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-ndp-accent" />
        </div>
      )}

      {registryError && (
        <div className="card p-6 text-center">
          <p className="text-ndp-error text-sm">{registryError}</p>
          <button onClick={onRetry} className="mt-3 px-4 py-2 bg-ndp-accent text-white rounded-lg text-sm font-medium hover:bg-ndp-accent/90 transition-colors">
            Retry
          </button>
        </div>
      )}

      {!registryLoading && !registryError && registry.length === 0 && (
        <div className="card p-10 text-center">
          <Download className="w-12 h-12 text-ndp-text-dim mx-auto mb-4 opacity-50" />
          <p className="text-ndp-text font-medium">No plugins available yet</p>
          <p className="text-sm text-ndp-text-dim mt-1.5">Community plugins will appear here once published.</p>
        </div>
      )}

      {!registryLoading && registry.length > 0 && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative w-full sm:max-w-md sm:flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ndp-text-dim pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('admin.plugins.discover.search_placeholder')}
                className="input w-full pl-9 pr-9 !py-1.5 !text-sm"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-ndp-text-dim hover:text-ndp-text hover:bg-white/5"
                  aria-label={t('admin.plugins.discover.clear_search')}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => setShowNewOnly((v) => !v)}
                aria-pressed={showNewOnly}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ring-1 transition-colors whitespace-nowrap',
                  showNewOnly
                    ? 'bg-ndp-accent/15 text-ndp-accent ring-ndp-accent/40'
                    : 'bg-white/[0.04] text-ndp-text-muted ring-white/10 hover:bg-white/[0.07]',
                )}
              >
                <Sparkles size={14} />
                {t('admin.plugins.discover.filter_new')}
              </button>

              <button
                type="button"
                onClick={() => setHideInstalled((v) => !v)}
                aria-pressed={hideInstalled}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ring-1 transition-colors whitespace-nowrap',
                  hideInstalled
                    ? 'bg-ndp-accent/15 text-ndp-accent ring-ndp-accent/40'
                    : 'bg-white/[0.04] text-ndp-text-muted ring-white/10 hover:bg-white/[0.07]',
                )}
              >
                {hideInstalled ? <EyeOff size={14} /> : <Eye size={14} />}
                {t('admin.plugins.discover.hide_installed')}
              </button>
            </div>
          </div>

          {filtered.length === 0 && (
            <div className="card p-10 text-center">
              <Search className="w-10 h-10 text-ndp-text-dim mx-auto mb-3 opacity-50" />
              <p className="text-ndp-text font-medium">{t('admin.plugins.discover.empty_title')}</p>
              <p className="text-sm text-ndp-text-dim mt-1.5">{t('admin.plugins.discover.empty_help')}</p>
            </div>
          )}

          {(() => {
            const renderCard = (plugin: RegistryPlugin) => {
              const isInstalled = installedIds.has(plugin.id);
              const cat = CATEGORY_CONFIG[plugin.category] || { label: plugin.category, color: 'bg-white/5 text-ndp-text-dim' };
              return (
                <div key={plugin.id} className="card p-5 flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <PluginInitial name={plugin.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-sm font-semibold text-ndp-text truncate">{plugin.name}</h3>
                        {isInstalled && (
                          <Check className="w-3.5 h-3.5 text-ndp-success flex-shrink-0" aria-label={t('admin.plugins.discover.installed_label')} />
                        )}
                      </div>
                      <p className="text-xs text-ndp-text-dim mt-0.5 truncate">
                        v{plugin.version}
                        {plugin.author && <> · {plugin.author}</>}
                        {' · '}{cat.label}
                      </p>
                    </div>
                    <a
                      href={plugin.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 -m-1.5 rounded-lg text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors flex-shrink-0"
                      title="View on GitHub"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>

                  {plugin.tags && plugin.tags.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {plugin.tags.map((tag) => {
                        const tagCfg = TAG_CONFIG[tag] || { label: tag };
                        return (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-white/[0.04] text-ndp-text-muted ring-1 ring-white/5"
                          >
                            {tagCfg.dot && (
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tagCfg.dot }} />
                            )}
                            {tagCfg.label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex-1 min-h-[2.5rem]">
                    {plugin.description && (
                      <p className="text-sm text-ndp-text-muted line-clamp-3">{plugin.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-ndp-text-dim">
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      {plugin.stars}
                    </span>
                    {plugin.downloads !== undefined && (
                      <span className="flex items-center gap-1" title="Total installs (GitHub release downloads)">
                        <Download className="w-3 h-3" />
                        {plugin.downloads}
                      </span>
                    )}
                    {plugin.updatedAt && (
                      <span>Updated {new Date(plugin.updatedAt).toLocaleDateString()}</span>
                    )}
                  </div>

                  <div className="pt-3 border-t border-white/5">
                    {isInstalled ? (
                      <button
                        onClick={onManage}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-ndp-text-muted bg-white/[0.04] hover:bg-white/[0.07] ring-1 ring-white/5 transition-colors"
                      >
                        <Package className="w-4 h-4" />
                        Manage
                      </button>
                    ) : (
                      (() => {
                        const incompat = plugin.compat?.status === 'incompatible';
                        return (
                          <button
                            onClick={() => onInstall(plugin)}
                            disabled={installing === plugin.id || incompat}
                            title={incompat ? (plugin.compat?.reason || `Requires Oscarr ${plugin.compat?.range}`) : undefined}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ring-1 ring-ndp-accent/30 text-ndp-accent bg-ndp-accent/[0.06] hover:bg-ndp-accent hover:text-white hover:ring-ndp-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {installing === plugin.id ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Installing…
                              </>
                            ) : incompat ? (
                              <>
                                <Download className="w-4 h-4" />
                                Requires Oscarr {plugin.compat?.range}
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                Install
                              </>
                            )}
                          </button>
                        );
                      })()
                    )}
                  </div>
                </div>
              );
            };
            return (
              <>
                {newPlugins.length > 0 && (
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ndp-accent mb-3 flex items-center gap-1.5">
                      <Sparkles size={12} />
                      {t('admin.plugins.discover.section_new')}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {newPlugins.map(renderCard)}
                    </div>
                  </section>
                )}

                {restPlugins.length > 0 && (
                  <section className={newPlugins.length > 0 ? 'mt-8' : ''}>
                    {newPlugins.length > 0 && (
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ndp-text-dim mb-3">
                        {t('admin.plugins.discover.section_rest')}
                      </p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {restPlugins.map(renderCard)}
                    </div>
                  </section>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
