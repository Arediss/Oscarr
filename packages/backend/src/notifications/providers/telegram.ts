import axios from 'axios';
import { renderNotificationTemplate, notifMediaLabel } from '@oscarr/shared';
import type { NotificationProvider, NotificationPayload } from '../types.js';

function buildText(payload: NotificationPayload): string {
  const locale = payload.language ?? 'en';
  if (payload.type === 'incident_banner') {
    return `*${renderNotificationTemplate('notifications.event.incident_banner', locale)}*\n${payload.message || ''}`;
  }
  const mediaLabel = notifMediaLabel(payload.mediaType, locale);
  const mediaSuffix = mediaLabel ? ` (${mediaLabel})` : '';
  let text = `*${payload.label ?? payload.type}*\n${payload.title}${mediaSuffix}${payload.username ? ` — ${payload.username}` : ''}`;
  if (payload.url) text += `\n[${renderNotificationTemplate('notifications.link.view_in_oscarr', locale)}](${payload.url})`;
  return text;
}

export const telegramProvider: NotificationProvider = {
  id: 'telegram',
  nameKey: 'admin.notifications.provider.telegram',
  icon: 'Send',
  settingsSchema: [
    {
      key: 'botToken',
      labelKey: 'admin.notifications.provider.telegram.bot_token',
      type: 'password',
      placeholder: '123456:ABC-DEF...',
      required: true,
    },
    {
      key: 'chatId',
      labelKey: 'admin.notifications.provider.telegram.chat_id',
      type: 'text',
      placeholder: '-1001234567890',
      required: true,
    },
  ],

  async send(settings, payload) {
    await axios.post(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
      chat_id: settings.chatId,
      text: buildText(payload),
      parse_mode: 'Markdown',
    });
  },

  async testConnection(settings, locale = 'en') {
    await axios.post(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
      chat_id: settings.chatId,
      text: `*${renderNotificationTemplate('notifications.test.title', locale)}*\n${renderNotificationTemplate('notifications.test.telegram', locale)}`,
      parse_mode: 'Markdown',
    });
  },
};
