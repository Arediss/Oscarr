import { Resend } from 'resend';
import { renderNotificationTemplate, notifMediaLabel } from '@oscarr/shared';
import type { NotificationProvider, NotificationPayload } from '../types.js';

function escapeHtml(text: string): string {
  return text.replaceAll(/&/g, '&amp;').replaceAll(/</g, '&lt;').replaceAll(/>/g, '&gt;').replaceAll(/"/g, '&quot;');
}

function buildHtml(payload: NotificationPayload): string {
  const locale = payload.language ?? 'en';
  const title = escapeHtml(payload.title);
  const username = payload.username ? escapeHtml(payload.username) : undefined;
  const mediaLabel = notifMediaLabel(payload.mediaType, locale);
  const msg = `${title}${mediaLabel ? ` (${mediaLabel})` : ''}${username ? ` — ${username}` : ''}`;
  const poster = payload.posterPath
    ? `<br/><img src="https://image.tmdb.org/t/p/w185${payload.posterPath}" alt="" style="border-radius:8px" />`
    : '';

  if (payload.type === 'incident_banner') {
    const incident = escapeHtml(renderNotificationTemplate('notifications.event.incident_banner', locale));
    return `<h2 style="margin:0 0 12px">${incident}</h2><p style="margin:0">${escapeHtml(payload.message || '')}</p>`;
  }
  return `<h2 style="margin:0 0 12px">${escapeHtml(payload.label ?? payload.type)}</h2><p style="margin:0">${msg}</p>${poster}`;
}

export const emailProvider: NotificationProvider = {
  id: 'email',
  nameKey: 'admin.notifications.provider.email',
  icon: 'Mail',
  settingsSchema: [
    {
      key: 'apiKey',
      labelKey: 'common.api_key',
      type: 'password',
      placeholder: 're_...',
      required: true,
    },
    {
      key: 'fromEmail',
      labelKey: 'admin.notifications.provider.email.from',
      type: 'text',
      placeholder: 'Oscarr <notifs@domain.com>',
      required: true,
    },
    {
      key: 'toEmail',
      labelKey: 'admin.notifications.provider.email.to',
      type: 'text',
      placeholder: 'admin@domain.com',
      required: true,
    },
  ],

  async send(settings, payload) {
    const resend = new Resend(settings.apiKey);
    await resend.emails.send({
      from: settings.fromEmail,
      to: [settings.toEmail],
      subject: `[Oscarr] ${payload.label ?? payload.type}`,
      html: buildHtml(payload),
    });
  },

  async testConnection(settings, locale = 'en') {
    const resend = new Resend(settings.apiKey);
    const testTitle = renderNotificationTemplate('notifications.test.title', locale);
    await resend.emails.send({
      from: settings.fromEmail,
      to: [settings.toEmail],
      subject: `[Oscarr] ${testTitle}`,
      html: `<h2>${escapeHtml(testTitle)}</h2><p>${escapeHtml(renderNotificationTemplate('notifications.test.email', locale))}</p>`,
    });
  },
};
