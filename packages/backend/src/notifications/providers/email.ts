import { renderNotificationTemplate, notifMediaLabel } from '@oscarr/shared';
import type { NotificationLocale } from '@oscarr/shared';
import type { NotificationProvider, NotificationPayload } from '../types.js';
import { sendMail } from '../../services/mailer.js';

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

/** Plain-text counterpart so the mail isn't HTML-only (spam filters and text clients both care). */
function buildText(payload: NotificationPayload, locale: NotificationLocale): string {
  if (payload.type === 'incident_banner') {
    return `${renderNotificationTemplate('notifications.event.incident_banner', locale)}\n\n${payload.message ?? ''}`;
  }
  const mediaLabel = notifMediaLabel(payload.mediaType, locale);
  return [
    payload.label ?? payload.type,
    `${payload.title}${mediaLabel ? ` (${mediaLabel})` : ''}${payload.username ? ` — ${payload.username}` : ''}`,
  ].join('\n\n');
}

/**
 * Email notification channel. It owns the recipient and nothing else: the transport (SMTP or
 * Resend, credentials, From address) is instance-wide and lives in Admin → System → Mail, shared
 * with password reset. One transport, several consumers — configuring it twice was the bug.
 */
export const emailProvider: NotificationProvider = {
  id: 'email',
  nameKey: 'admin.notifications.provider.email',
  icon: 'Mail',
  settingsSchema: [
    {
      key: 'toEmail',
      labelKey: 'admin.notifications.provider.email.to',
      type: 'text',
      placeholder: 'admin@domain.com',
      required: true,
    },
  ],

  async send(settings, payload) {
    await sendMail({
      to: settings.toEmail,
      subject: `[Oscarr] ${payload.label ?? payload.type}`,
      html: buildHtml(payload),
      text: buildText(payload, payload.language ?? 'en'),
    });
  },

  async testConnection(settings, locale = 'en') {
    const testTitle = renderNotificationTemplate('notifications.test.title', locale);
    const body = renderNotificationTemplate('notifications.test.email', locale);
    await sendMail({
      to: settings.toEmail,
      subject: `[Oscarr] ${testTitle}`,
      html: `<h2>${escapeHtml(testTitle)}</h2><p>${escapeHtml(body)}</p>`,
      text: `${testTitle}\n\n${body}`,
    });
  },
};
