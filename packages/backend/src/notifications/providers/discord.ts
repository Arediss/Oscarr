import axios from 'axios';
import { renderNotificationTemplate, notifMediaLabel } from '@oscarr/shared';
import type { NotificationProvider, NotificationPayload } from '../types.js';
import { assertPublicUrl } from '../../utils/ssrfGuard.js';

function buildDescription(payload: NotificationPayload): string {
  if (payload.type === 'incident_banner') return payload.message || '';
  const mediaLabel = notifMediaLabel(payload.mediaType, payload.language ?? 'en');
  const mediaSuffix = mediaLabel ? ` (${mediaLabel})` : '';
  return `**${payload.title}**${mediaSuffix}${payload.username ? ` — ${payload.username}` : ''}`;
}

export const discordProvider: NotificationProvider = {
  id: 'discord',
  nameKey: 'admin.notifications.provider.discord',
  icon: 'MessageCircle',
  settingsSchema: [
    {
      key: 'webhookUrl',
      labelKey: 'admin.notifications.provider.discord.webhook_url',
      type: 'password',
      placeholder: 'https://discord.com/api/webhooks/...',
      required: true,
    },
  ],

  async send(settings, payload) {
    await assertPublicUrl(settings.webhookUrl);
    const posterUrl = payload.posterPath ? `https://image.tmdb.org/t/p/w185${payload.posterPath}` : undefined;
    await axios.post(settings.webhookUrl, {
      embeds: [{
        title: payload.label ?? payload.type,
        description: buildDescription(payload),
        url: payload.url || undefined,
        color: payload.color ?? 0x808080,
        thumbnail: posterUrl ? { url: posterUrl } : undefined,
        footer: { text: 'Oscarr' },
        timestamp: new Date().toISOString(),
      }],
    });
  },

  async testConnection(settings, locale = 'en') {
    await assertPublicUrl(settings.webhookUrl);
    await axios.post(settings.webhookUrl, {
      embeds: [{
        title: renderNotificationTemplate('notifications.test.title', locale),
        description: renderNotificationTemplate('notifications.test.discord', locale),
        color: 0x10b981,
        footer: { text: 'Oscarr' },
      }],
    });
  },
};
