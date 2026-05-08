import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { usePluginUI } from '@/plugins/usePlugins';
import { PluginAdminTab } from '@/plugins/PluginAdminTab';
import { ADMIN_TABS, findGroupForTab } from './admin/tabsConfig';

import { DashboardTab } from './admin/DashboardTab';
import { BackupsTab } from './admin/BackupsTab';
import { InstanceTab } from './admin/InstanceTab';
import { FeaturesTab } from './admin/FeaturesTab';
import { DangerTab } from './admin/DangerTab';
import { UsersTab } from './admin/UsersTab';
import { ServicesTab } from './admin/ServicesTab';
import { QualityTab } from './admin/QualityTab';
import { PathsTab } from './admin/PathsTab';
import { RoutingRulesTab } from './admin/RoutingRulesTab';
import { KeywordsTab } from './admin/KeywordsTab';
import { BlacklistTab } from './admin/BlacklistTab';
import { NotificationsTab } from './admin/NotificationsTab';
import { JobsTab } from './admin/JobsTab';
import { LogsTab } from './admin/LogsTab';
import { PluginsTab } from './admin/PluginsTab';
import { RolesTab } from './admin/RolesTab';
import { HomepageTab } from './admin/HomepageTab';
import { LinksTab } from './admin/LinksTab';
import { AuthProvidersTab } from './admin/AuthProvidersTab';
import { ApiKeysTab } from './admin/ApiKeysTab';

export default function AdminPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { contributions: pluginTabs } = usePluginUI('admin.tabs');

  const pluginTabIds = useMemo(
    () => pluginTabs.map((c) => `plugin:${c.pluginId}`),
    [pluginTabs]
  );

  const tabFromUrl = searchParams.get('tab');
  const allTabIds = [...ADMIN_TABS.map((tb) => tb.id), ...pluginTabIds];
  const defaultTab = ADMIN_TABS[0]?.id ?? 'users';
  const activeTab = tabFromUrl && allTabIds.includes(tabFromUrl) ? tabFromUrl : defaultTab;
  const activeGroup = findGroupForTab(activeTab);

  const canAccess = !!user && hasPermission('admin.*');
  useEffect(() => {
    if (user && !hasPermission('admin.*')) navigate('/');
  }, [user, hasPermission, navigate]);
  if (!canAccess) return null;

  const activePluginTab = activeTab.startsWith('plugin:') ? activeTab.replace('plugin:', '') : null;
  const showGroupHeader = !!activeGroup && !activePluginTab;

  const setTab = (id: string) => setSearchParams({ tab: id }, { replace: true });

  return (
    <div className="max-w-[1800px] mx-auto px-4 sm:px-6 pt-4 pb-6" key={activeTab}>
      {showGroupHeader && activeGroup && activeGroup.tabs.length > 1 && (
        <div className="mb-6 flex gap-2 border-b border-white/5 pb-3 overflow-x-auto">
          {activeGroup.tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={clsx(
                  'flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0',
                  isActive
                    ? 'bg-ndp-accent/10 text-ndp-accent'
                    : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5'
                )}
              >
                <Icon className="w-4 h-4" />
                {t(tab.label)}
              </button>
            );
          })}
        </div>
      )}

      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'instance' && <InstanceTab />}
      {activeTab === 'features' && <FeaturesTab />}
      {activeTab === 'homepage' && <HomepageTab />}
      {activeTab === 'links' && <LinksTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'roles' && <RolesTab />}
      {activeTab === 'auth' && <AuthProvidersTab />}
      {activeTab === 'api-keys' && <ApiKeysTab />}
      {activeTab === 'services' && <ServicesTab />}
      {activeTab === 'quality' && <QualityTab />}
      {activeTab === 'paths' && <PathsTab />}
      {activeTab === 'rules' && <RoutingRulesTab />}
      {activeTab === 'keywords' && <KeywordsTab />}
      {activeTab === 'blacklist' && <BlacklistTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'jobs' && <JobsTab />}
      {activeTab === 'logs' && <LogsTab />}
      {activeTab === 'backups' && <BackupsTab />}
      {activeTab === 'danger' && <DangerTab />}
      {activeTab === 'plugins' && <PluginsTab />}
      {activePluginTab && <PluginAdminTab pluginId={activePluginTab} />}
    </div>
  );
}
