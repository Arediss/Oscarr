import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { getAppSettings, patchAppSettings } from '../../utils/appSettings.js';

interface ChecklistItem {
  id: string;
  required: boolean;
  done: boolean;
  href: string;
}

async function computeItems(): Promise<ChecklistItem[]> {
  const [mediaServer, radarr, sonarr, quality, settings, rules, notifProviders] = await Promise.all([
    prisma.service.count({ where: { type: { in: ['plex', 'jellyfin', 'emby'] }, enabled: true } }),
    prisma.service.count({ where: { type: 'radarr', enabled: true } }),
    prisma.service.count({ where: { type: 'sonarr', enabled: true } }),
    prisma.qualityOption.count(),
    getAppSettings(),
    prisma.folderRule.count(),
    prisma.notificationProviderConfig.count({ where: { enabled: true } }),
  ]);
  const hasDefaultFolder = !!(settings?.defaultMovieFolder || settings?.defaultTvFolder || settings?.defaultAnimeFolder);

  return [
    { id: 'media-server', required: true, done: mediaServer > 0, href: '/admin?tab=services' },
    { id: 'radarr', required: true, done: radarr > 0, href: '/admin?tab=services' },
    { id: 'sonarr', required: true, done: sonarr > 0, href: '/admin?tab=services' },
    { id: 'quality-options', required: true, done: quality > 0, href: '/admin?tab=quality' },
    { id: 'default-folders', required: true, done: hasDefaultFolder, href: '/admin?tab=paths' },
    { id: 'routing-rule', required: false, done: rules > 0, href: '/admin?tab=rules' },
    { id: 'notification-provider', required: false, done: notifProviders > 0, href: '/admin?tab=notifications' },
  ];
}

export async function setupChecklistRoutes(app: FastifyInstance) {
  app.get('/setup-checklist', async () => {
    const settings = await getAppSettings();
    const items = await computeItems();
    return { items, dismissed: settings?.setupChecklistDismissed ?? false };
  });

  app.post('/setup-checklist/dismiss', async () => {
    await patchAppSettings({ setupChecklistDismissed: true });
    return { ok: true };
  });

  app.post('/setup-checklist/reset', async () => {
    await patchAppSettings({ setupChecklistDismissed: false });
    return { ok: true };
  });
}
