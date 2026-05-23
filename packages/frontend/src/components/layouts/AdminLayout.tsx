import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Menu, X, Search, ArrowUpCircle, ExternalLink, AlertCircle, Bell, CheckCheck, ChevronLeft, Home, MessageSquarePlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Diacritic-insensitive lowercase so "systeme" matches "Système" and "acces" matches "Accès".
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replaceAll(/\p{Diacritic}/gu, '').trim();

// Show ⌘K on Apple platforms (macOS, iPadOS — navigator.platform starts with "Mac" or "iPad")
// and Ctrl+K everywhere else. The keybinding itself accepts both modifiers either way.
const isAppleHost = typeof navigator !== 'undefined' && /mac|ipad|iphone/i.test(navigator.platform);
const shortcutHint = isAppleHost ? '⌘K' : 'Ctrl+K';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeaturesContext';
import { useVersionInfo } from '@/hooks/useVersionInfo';
import { usePluginUpdatesCount } from '@/hooks/usePluginUpdatesCount';
import { ADMIN_GROUPS, ADMIN_TABS, findGroupForTab } from '@/pages/admin/tabsConfig';
import { usePluginUI } from '@/plugins/usePlugins';
import { DynamicIcon } from '@/plugins/DynamicIcon';
import { UserCluster } from '@/components/nav/UserCluster';
import NotificationBell from '@/components/NotificationBell';
import NotificationList from '@/components/NotificationList';
import { useNotifications } from '@/hooks/useNotifications';
import { AdminJumpButton } from '@/components/nav/AdminJumpButton';
import SetupChecklistMenu from '@/components/nav/SetupChecklistMenu';
import { EncryptionUpgradeBanner } from '@/pages/admin/EncryptionUpgradeBanner';
import { FeedbackModal } from '@/pages/admin/FeedbackModal';

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { features } = useFeatures();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { contributions: pluginTabs } = usePluginUI('admin.tabs');
  const versionInfo = useVersionInfo();
  const pluginUpdatesCount = usePluginUpdatesCount();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'main' | 'notifications'>('main');
  const [warnings, setWarnings] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [viewAsRole, setViewAsRoleState] = useState<string | null>(() => sessionStorage.getItem('view-as-role'));
  const { unreadCount, markAllRead } = useNotifications();

  useEffect(() => {
    if (!drawerOpen) setMobileView('main');
  }, [drawerOpen]);

  // `sidebarContent` is rendered twice (desktop aside + mobile drawer), so a plain ref would
  // get overwritten by whichever input mounts last — which on desktop is the hidden drawer copy.
  // Look up the currently visible one by data attribute + offsetParent check instead.
  const getVisibleSearchInput = () => {
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-admin-search]');
    return Array.from(inputs).find((el) => el.offsetParent !== null) ?? null;
  };

  const setViewAsRole = (role: string | null) => {
    if (role) sessionStorage.setItem('view-as-role', role);
    else sessionStorage.removeItem('view-as-role');
    setViewAsRoleState(role);
  };

  const refreshWarnings = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/setup-status');
      setWarnings(data.warnings || {});
    } catch (err) {
      // Non-blocking: if setup-status is down, warnings just don't refresh. Keep the last known
      // warnings rather than clearing them so a transient 500 doesn't make the dots vanish.
      console.error('AdminLayout refreshWarnings failed', err);
    }
  }, []);

  const currentTab = searchParams.get('tab');
  useEffect(() => { refreshWarnings(); }, [currentTab, refreshWarnings]);
  useEffect(() => { setDrawerOpen(false); }, [currentTab]);

  const pluginTabItems = useMemo(
    () =>
      pluginTabs.map((c) => ({
        id: `plugin:${c.pluginId}`,
        label: typeof c.props.label === 'string' ? c.props.label : c.pluginId,
        pluginIcon: typeof c.props.icon === 'string' ? c.props.icon : 'Puzzle',
      })),
    [pluginTabs]
  );

  const allTabIds = [...ADMIN_TABS.map((tb) => tb.id), ...pluginTabItems.map((tb) => tb.id)];
  const defaultTab = ADMIN_TABS[0]?.id ?? 'dashboard';
  const activeTab = currentTab && allTabIds.includes(currentTab) ? currentTab : defaultTab;
  const activeGroup = findGroupForTab(activeTab);
  const activeTabLabel =
    ADMIN_TABS.find((tb) => tb.id === activeTab)?.label ??
    pluginTabItems.find((tb) => tb.id === activeTab)?.label ??
    'admin.title';

  const setActiveTab = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  /** Flat list of searchable entries — native admin tabs + plugin-contributed tabs.
   *  Each entry carries its parent group label so we can both match against it (typing
   *  a group name surfaces all its tabs) and display it under the tab name in results. */
  type SearchEntry = {
    id: string;
    label: string;
    groupLabel: string;
    icon: LucideIcon | null;
    pluginIcon?: string;
    hasWarning: boolean;
  };

  const pluginGroupLabel = t('admin.sidebar.plugin_pages', 'Pages de plugins');
  const searchableTabs: SearchEntry[] = useMemo(() => {
    const nativeEntries: SearchEntry[] = ADMIN_GROUPS.flatMap((group) => {
      const groupLabel = t(group.label);
      return group.tabs.map((tab) => ({
        id: tab.id,
        label: t(tab.label),
        groupLabel,
        icon: tab.icon,
        hasWarning: !!warnings[tab.id],
      }));
    });
    const pluginEntries: SearchEntry[] = pluginTabItems.map((tb) => ({
      id: tb.id,
      label: tb.label,
      groupLabel: pluginGroupLabel,
      icon: null,
      pluginIcon: tb.pluginIcon,
      hasWarning: !!warnings[tb.id],
    }));
    return [...nativeEntries, ...pluginEntries];
  }, [t, warnings, pluginTabItems, pluginGroupLabel]);

  const trimmedQuery = searchQuery.trim();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return null;
    const needle = normalize(trimmedQuery);
    return searchableTabs.filter(
      (e) => normalize(e.label).includes(needle) || normalize(e.groupLabel).includes(needle)
    );
  }, [trimmedQuery, searchableTabs]);

  /** Global ⌘/Ctrl+K focuses the search input from anywhere in the admin. Works even when the
   *  user is typing in another field — we preventDefault to win the browser's default (Chrome
   *  opens the omnibox on Ctrl+K) and the event runs in capture phase so nested handlers can't
   *  swallow it first. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        const input = getVisibleSearchInput();
        if (!input) return;
        e.preventDefault();
        input.focus();
        input.select();
      }
    };
    globalThis.addEventListener('keydown', onKey, { capture: true });
    return () => globalThis.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // Redirect non-admins in an effect — calling navigate() during render triggers a React warning
  // and can cause a cross-component update. The same-render `return null` below still prevents
  // rendering the admin chrome for the one frame before the redirect kicks in.
  const canAccess = hasPermission('admin.*');
  useEffect(() => {
    if (!canAccess) navigate('/');
  }, [canAccess, navigate]);
  if (!canAccess) return null;

  const pickSearchResult = (id: string) => {
    setSearchQuery('');
    getVisibleSearchInput()?.blur();
    setActiveTab(id);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (searchQuery) setSearchQuery('');
      else e.currentTarget.blur();
      e.preventDefault();
    } else if (e.key === 'Enter' && searchResults && searchResults.length > 0) {
      pickSearchResult(searchResults[0].id);
    }
  };

  /** Group button — icon + label + subtitle. Active when any of its child tabs is selected. */
  const renderGroupButton = (group: typeof ADMIN_GROUPS[number]) => {
    const Icon = group.icon;
    const isActive = activeGroup?.id === group.id;
    const hasWarning = group.tabs.some((t) => warnings[t.id] && !isActive);
    const landingTab =
      isActive && group.tabs.some((t) => t.id === activeTab) ? activeTab : group.tabs[0].id;

    // Multi-tab: derive subtitle from tab labels (DRY). Single-tab: fall back to the explicit
    // description so every row stays the same height.
    const subtitle =
      group.tabs.length > 1
        ? group.tabs.map((tb) => t(tb.label)).join(', ')
        : group.description
        ? t(group.description)
        : null;

    return (
      <button
        key={group.id}
        onClick={() => setActiveTab(landingTab)}
        aria-current={isActive ? 'page' : undefined}
        className={clsx(
          'flex items-start gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors',
          isActive
            ? 'bg-ndp-accent/10 text-ndp-accent'
            : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5'
        )}
      >
        <Icon className={clsx('w-4 h-4 flex-shrink-0 mt-0.5', isActive ? 'text-ndp-accent' : 'text-ndp-text-dim')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{t(group.label)}</span>
            {hasWarning && <AlertCircle className="w-3.5 h-3.5 text-ndp-warning flex-shrink-0" aria-label={t('admin.sidebar.needs_attention')} />}
          </div>
          {subtitle && (
            <p className={clsx('text-[11px] leading-snug mt-0.5 truncate', isActive ? 'text-ndp-accent/70' : 'text-ndp-text-dim')}>
              {subtitle}
            </p>
          )}
        </div>
        {group.id === 'plugins' && pluginUpdatesCount > 0 && (
          <span className="self-center min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-ndp-accent/90 text-white text-[10px] font-semibold leading-none flex-shrink-0">
            {pluginUpdatesCount}
          </span>
        )}
      </button>
    );
  };

  const renderPluginTabButton = (id: string, label: string, iconEl: React.ReactNode) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      aria-current={activeTab === id ? 'page' : undefined}
      className={clsx(
        'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors text-left',
        activeTab === id
          ? 'bg-ndp-accent/10 text-ndp-accent'
          : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5'
      )}
    >
      {iconEl}
      <span className="flex-1 truncate">{label}</span>
      {warnings[id] && activeTab !== id && (
        <AlertCircle className="w-3.5 h-3.5 text-ndp-warning flex-shrink-0" aria-label={t('admin.sidebar.needs_attention')} />
      )}
    </button>
  );

  const searchInput = (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ndp-text-dim" />
      <input
        data-admin-search
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder={t('admin.sidebar.search_placeholder', 'Rechercher…')}
        className="w-full h-9 pl-9 pr-12 rounded-lg bg-white/5 border border-white/5 text-sm text-ndp-text placeholder:text-ndp-text-dim focus:outline-none focus:border-ndp-accent/30 focus:bg-white/[0.07]"
        aria-label={t('admin.sidebar.search_placeholder', 'Rechercher…')}
      />
      {searchQuery ? (
        <button
          onClick={() => { setSearchQuery(''); getVisibleSearchInput()?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-ndp-text-dim hover:text-ndp-text hover:bg-white/10 transition-colors"
          aria-label={t('common.clear', 'Clear')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : (
        <kbd className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 items-center gap-0.5 px-1.5 h-5 rounded bg-white/5 text-[10px] font-mono text-ndp-text-dim border border-white/5 pointer-events-none">
          {shortcutHint}
        </kbd>
      )}
    </div>
  );

  const renderSearchResult = (entry: SearchEntry) => {
    const isActive = activeTab === entry.id;
    const Icon = entry.icon;
    return (
      <button
        key={entry.id}
        onClick={() => pickSearchResult(entry.id)}
        className={clsx(
          'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors',
          isActive ? 'bg-ndp-accent/10 text-ndp-accent' : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5',
        )}
      >
        {Icon ? (
          <Icon className={clsx('w-4 h-4 flex-shrink-0', isActive ? 'text-ndp-accent' : 'text-ndp-text-dim')} />
        ) : entry.pluginIcon ? (
          <DynamicIcon name={entry.pluginIcon} className="w-4 h-4 flex-shrink-0" />
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{entry.label}</span>
            {entry.hasWarning && !isActive && (
              <AlertCircle className="w-3.5 h-3.5 text-ndp-warning flex-shrink-0" aria-label={t('admin.sidebar.needs_attention')} />
            )}
          </div>
          <p className={clsx('text-[11px] truncate mt-0.5', isActive ? 'text-ndp-accent/70' : 'text-ndp-text-dim')}>
            {entry.groupLabel}
          </p>
        </div>
      </button>
    );
  };

  const tabList = (
    <>
      {ADMIN_GROUPS.map(renderGroupButton)}
      {pluginTabItems.length > 0 && (
        <div className="!mt-3 pt-3 border-t border-white/5">
          <p className="text-[10px] text-ndp-text-dim uppercase tracking-wider px-3 mb-3 font-semibold">
            {pluginGroupLabel}
          </p>
          {pluginTabItems.map((tb) =>
            renderPluginTabButton(tb.id, tb.label, <DynamicIcon name={tb.pluginIcon} className="w-4 h-4 flex-shrink-0" />)
          )}
        </div>
      )}
    </>
  );

  /** Sidebar body. `withSearch=true` (mobile drawer) keeps the legacy inline search + results
   *  in the nav, since mobile doesn't see the topbar search. `withSearch=false` (desktop aside)
   *  drops the wordmark and search — those live in the topbar now — and always renders tabs. */
  const sidebarBody = (withSearch: boolean) => (
    <div className="flex flex-col h-full">
      {withSearch && (
        <div className="px-3 pt-5 pb-3 space-y-3">
          <p className="px-1 text-lg font-bold text-ndp-text tracking-tight" role="presentation">
            {features.siteName || 'Oscarr'}
          </p>
          {searchInput}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {withSearch && searchResults !== null ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-6 text-xs text-ndp-text-dim text-center">
              {t('admin.sidebar.search_no_results', 'Aucun résultat')}
            </p>
          ) : (
            searchResults.map(renderSearchResult)
          )
        ) : tabList}
      </nav>

      {versionInfo?.updateAvailable && versionInfo.latest && (
        <a
          href={versionInfo.releaseUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-ndp-accent/10 border border-ndp-accent/20 text-ndp-accent text-xs font-medium hover:bg-ndp-accent/15 transition-colors"
        >
          <ArrowUpCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block truncate">{t('admin.sidebar.update_available', 'Update available')}</span>
            <span className="block text-[10px] text-ndp-accent/70 font-normal">v{versionInfo.latest}</span>
          </span>
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
      )}

      <button
        type="button"
        onClick={() => setFeedbackOpen(true)}
        className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 text-ndp-text-muted hover:text-ndp-text text-xs font-medium transition-colors"
      >
        <MessageSquarePlus className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">{t('admin.feedback.button')}</span>
      </button>
    </div>
  );

  /** Mobile-only topbar — just the active page title, no branding/search (both in the drawer).
   *  Plugin icons are rendered dynamically by DynamicIcon. */
  const activePluginTabItem = pluginTabItems.find((tb) => tb.id === activeTab);
  const headerIcon = activeGroup ? (
    <activeGroup.icon className="w-5 h-5 text-ndp-accent" />
  ) : activePluginTabItem ? (
    <DynamicIcon name={activePluginTabItem.pluginIcon} className="w-5 h-5 text-ndp-accent" />
  ) : null;
  const headerLabel = activeGroup ? t(activeGroup.label) : activePluginTabItem?.label ?? '';

  const mobileTopBar = (
    <header className="h-16 flex-shrink-0">
      <div className="max-w-[1800px] mx-auto h-full flex items-center px-4 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          {headerIcon}
          <h1 className="text-base font-semibold text-ndp-text truncate">{headerLabel}</h1>
        </div>
      </div>
    </header>
  );

  /** Desktop topbar — wordmark on the left, viewport-centered search, icons on the right.
   *  Search is absolutely positioned so the wordmark length doesn't shift it (matches the
   *  /home topbar layout). */
  const desktopTopBar = (
    <header className="h-16 flex-shrink-0">
      <div
        className="h-full relative flex items-center gap-4 pl-3 sm:pl-4"
        style={{ paddingRight: 'max(1.5rem, calc((100vw - 1800px) / 2 + 1.5rem))' }}
      >
        <p className="text-lg font-bold text-ndp-text tracking-tight flex-shrink-0 relative z-10" role="presentation">
          {features.siteName || 'Oscarr'}
        </p>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-full max-w-lg px-4 pointer-events-auto">
            {searchInput}
            {searchResults !== null && (
              <div className="absolute left-4 right-4 top-full mt-2 card shadow-2xl shadow-black/50 border border-white/10 animate-fade-in overflow-hidden z-50">
                <div className="max-h-96 overflow-y-auto py-1 px-1 space-y-0.5">
                  {searchResults.length === 0 ? (
                    <p className="px-3 py-6 text-xs text-ndp-text-dim text-center">
                      {t('admin.sidebar.search_no_results', 'Aucun résultat')}
                    </p>
                  ) : (
                    searchResults.map(renderSearchResult)
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-shrink-0 relative z-10">
          <SetupChecklistMenu />
          <AdminJumpButton />
          <NotificationBell />
          <UserCluster viewAsRole={viewAsRole} onViewAsRoleChange={setViewAsRole} variant="compact" />
        </div>
      </div>
    </header>
  );

  return (
    <div className="h-dvh bg-ndp-bg flex flex-col overflow-hidden">
      {/* Topbar spans the full viewport (above the sidebar) so its `max-w-[1800px] mx-auto` is
          centered against the same width as Layout.tsx's home topbar. Otherwise the max-w
          centers within `viewport - sidebar`, shifting avatar/notif ~60px right between pages. */}
      <div className="hidden md:block border-b border-white/5">{desktopTopBar}</div>

      <div className="flex flex-1 min-h-0">
      <aside className="hidden md:flex md:flex-col w-72 flex-shrink-0 border-r border-white/5 overflow-y-auto">
        {sidebarBody(false)}
      </aside>

      {/* Mobile bottom nav — menu button + active tab label. Avatar/notif/admin-jump live in
          the drawer rows (matching the home layout) so the bottom strip stays minimal. */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-ndp-surface/95 backdrop-blur-xl border-t border-white/5 flex items-center h-14 px-3 gap-2"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <button
          onClick={() => setDrawerOpen(true)}
          className="relative p-2 text-ndp-text-muted hover:text-ndp-text rounded-lg hover:bg-white/5 transition-colors"
          aria-label={t('admin.open_menu', 'Open admin menu')}
        >
          <Menu className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-ndp-accent rounded-full animate-pulse" />
          )}
        </button>
        <h1 className="text-sm font-semibold text-ndp-text truncate flex-1 min-w-0">
          {t(activeTabLabel)}
        </h1>
      </div>

      <div
        className={clsx(
          'md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
          drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
      />
      <aside
        className={clsx(
          'md:hidden fixed inset-x-0 bottom-0 top-0 z-50 bg-ndp-surface border-t border-white/5 transform transition-transform duration-300 flex flex-col',
          drawerOpen ? 'translate-y-0' : 'translate-y-full'
        )}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-hidden={!drawerOpen}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-white/5 flex-shrink-0">
          {mobileView === 'notifications' ? (
            <button
              onClick={() => setMobileView('main')}
              className="flex items-center gap-1.5 -ml-1.5 px-1.5 py-1 rounded-lg hover:bg-white/5 transition-colors"
              aria-label={t('common.back', 'Back')}
            >
              <ChevronLeft className="w-4 h-4 text-ndp-text-muted" />
              <span className="text-base font-bold text-ndp-text">{t('notifications.title')}</span>
            </button>
          ) : (
            <span className="text-base font-bold text-ndp-text tracking-tight">
              {features.siteName || 'Oscarr'}
            </span>
          )}
          <div className="flex items-center gap-1">
            {mobileView === 'notifications' && unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-xs text-ndp-text-dim hover:text-ndp-accent transition-colors px-2 py-1 rounded hover:bg-white/5"
                title={t('notifications.mark_all_read')}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>{t('notifications.mark_all_read')}</span>
              </button>
            )}
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              aria-label={t('common.close', 'Close')}
            >
              <X className="w-4 h-4 text-ndp-text-muted" />
            </button>
          </div>
        </div>

        {mobileView === 'main' ? (
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="px-3 pt-3 pb-2">
              <UserCluster
                viewAsRole={viewAsRole}
                onViewAsRoleChange={setViewAsRole}
                variant="expanded"
              />
            </div>
            <div className="h-px bg-white/5 mx-3" />

            <div className="px-3 pt-3 pb-2">
              {searchInput}
            </div>

            <nav className="px-3 pb-3 space-y-0.5">
              {searchResults !== null ? (
                searchResults.length === 0 ? (
                  <p className="px-3 py-6 text-xs text-ndp-text-dim text-center">
                    {t('admin.sidebar.search_no_results', 'Aucun résultat')}
                  </p>
                ) : (
                  searchResults.map(renderSearchResult)
                )
              ) : tabList}
            </nav>

            <div className="h-px bg-white/5 mx-3" />

            <div className="px-3 py-3 space-y-0.5">
              <button
                onClick={() => setMobileView('notifications')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-ndp-text-muted hover:text-ndp-text hover:bg-white/5 transition-colors"
              >
                <Bell className="w-5 h-5 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{t('notifications.title')}</span>
                {unreadCount > 0 && (
                  <span className="min-w-[20px] h-5 flex items-center justify-center rounded-full bg-ndp-accent text-[10px] font-bold text-white px-1.5">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              <Link
                to="/"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-ndp-text-muted hover:text-ndp-accent hover:bg-white/5 transition-colors"
              >
                <Home className="w-5 h-5 flex-shrink-0" />
                <span className="truncate">{t('admin.back_to_app', 'Retour Oscarr')}</span>
              </Link>
            </div>

            {versionInfo?.updateAvailable && versionInfo.latest && (
              <a
                href={versionInfo.releaseUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="mx-3 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-ndp-accent/10 border border-ndp-accent/20 text-ndp-accent text-xs font-medium hover:bg-ndp-accent/15 transition-colors"
              >
                <ArrowUpCircle className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{t('admin.sidebar.update_available', 'Update available')}</span>
                  <span className="block text-[10px] text-ndp-accent/70 font-normal">v{versionInfo.latest}</span>
                </span>
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <NotificationList actionsAlwaysVisible onAction={() => setDrawerOpen(false)} />
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="md:hidden">{mobileTopBar}</div>
        <main id="main" tabIndex={-1} className="flex-1 min-w-0 min-h-0 overflow-y-auto">{children}</main>
      </div>
      </div>
      <EncryptionUpgradeBanner />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
