/** Single source of truth for `notifications.msg.*` localized templates.
 *
 *  Two consumers:
 *    - Backend `safeUserNotify` pre-translates the event-bus payload at emit time so plugin
 *      subscribers (Leonarr Discord embed, Slack pushers, …) get readable text instead of
 *      raw i18n keys.
 *    - Frontend NotificationBell re-translates per-user-language at render time.
 *
 *  Keeping both consumers on the same import means a new notification key (or a copy tweak
 *  in an existing one) lands once and propagates everywhere — no risk of the backend
 *  shipping a key the frontend doesn't know about, or vice versa. Frontend's i18next bundle
 *  doesn't import this directly today (it copies into `translation.json` as part of the
 *  build) — adding a CI check that `translation.json[key] === NOTIFICATION_TEMPLATES[lang][key]`
 *  is the next step if the locales diverge in practice.
 *
 *  Add a key here when you add a new `notifications.msg.*` payload type. Templates use the
 *  `{{var}}` interpolation convention — same syntax as i18next + the backend's
 *  `translateNotif` helper, so they're substitutable. */

export type NotificationLocale = 'en' | 'fr';

/** Each value is a Mustache-style template. `{{var}}` placeholders are filled from the
 *  caller's `metadata.msgParams` — see backend safeUserNotify and frontend NotificationBell
 *  for the rendering side. */
export const NOTIFICATION_TEMPLATES: Record<NotificationLocale, Record<string, string>> = {
  en: {
    'notifications.msg.request_auto_approved': 'Your request for "{{title}}" has been auto-approved.',
    'notifications.msg.request_approved':      'Your request for "{{title}}" has been approved.',
    'notifications.msg.request_declined':      'Your request for "{{title}}" has been declined.',
    'notifications.msg.media_available':       '"{{title}}" is now available.',
    'notifications.msg.support_reply':         'Reply on your ticket #{{ticketId}}',
    // Channel/broadcast pieces — rendered at the INSTANCE language by the providers/registry.
    'notifications.media_type.movie':          'Movie',
    'notifications.media_type.tv':             'Series',
    'notifications.link.view_in_oscarr':       'View in Oscarr',
    'notifications.event.request_new':         'New request',
    'notifications.event.request_approved':    'Request approved',
    'notifications.event.request_declined':    'Request declined',
    'notifications.event.media_available':     'Media available',
    'notifications.event.incident_banner':     'Incident',
    'notifications.test.title':                'Test',
    'notifications.test.telegram':             'Telegram notification OK!',
    'notifications.test.discord':              'Discord notification OK!',
    'notifications.test.email':                'Email notification OK!',
    'notifications.push.media_available.title':'{{title}} is available!',
    'notifications.push.media_available.body': 'Your requested media is now ready to watch.',
  },
  fr: {
    'notifications.msg.request_auto_approved': 'Votre demande pour "{{title}}" a été approuvée automatiquement.',
    'notifications.msg.request_approved':      'Votre demande pour "{{title}}" a été approuvée.',
    'notifications.msg.request_declined':      'Votre demande pour "{{title}}" a été refusée.',
    'notifications.msg.media_available':       '"{{title}}" est maintenant disponible.',
    'notifications.msg.support_reply':         'Réponse sur votre ticket #{{ticketId}}',
    'notifications.media_type.movie':          'Film',
    'notifications.media_type.tv':             'Série',
    'notifications.link.view_in_oscarr':       'Voir dans Oscarr',
    'notifications.event.request_new':         'Nouvelle demande',
    'notifications.event.request_approved':    'Demande approuvée',
    'notifications.event.request_declined':    'Demande refusée',
    'notifications.event.media_available':     'Média disponible',
    'notifications.event.incident_banner':     'Incident',
    'notifications.test.title':                'Test',
    'notifications.test.telegram':             'Notification Telegram OK !',
    'notifications.test.discord':              'Notification Discord OK !',
    'notifications.test.email':                'Notification e-mail OK !',
    'notifications.push.media_available.title':'{{title}} est disponible !',
    'notifications.push.media_available.body': 'Le média que vous avez demandé est prêt à regarder.',
  },
};

/** Render a template against `params`. Returns the raw key when the lookup fails so a typo
 *  or missing locale stays visible (vs. silently falling back to an empty string). */
export function renderNotificationTemplate(
  key: string,
  locale: NotificationLocale,
  params: Record<string, unknown> = {},
): string {
  const bundle = NOTIFICATION_TEMPLATES[locale] ?? NOTIFICATION_TEMPLATES.en;
  const fallback = NOTIFICATION_TEMPLATES.en;
  const template = bundle[key] ?? fallback[key];
  if (!template) return key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (
    params[k] !== undefined ? String(params[k]) : `{{${k}}}`
  ));
}

/** Coerce any language string to a supported notification locale (single source for the
 *  `fr` vs `en` decision used across safeNotify, the registry and the providers). */
export function toNotificationLocale(lang: string | null | undefined): NotificationLocale {
  return lang === 'fr' ? 'fr' : 'en';
}

/** Localized media-type word ("Movie"/"Film", "Series"/"Série"); empty when the payload has no
 *  media type. Single source consumed by every channel provider — no per-provider ternary. */
export function notifMediaLabel(mediaType: 'movie' | 'tv' | undefined | null, locale: NotificationLocale): string {
  if (!mediaType) return '';
  return renderNotificationTemplate(`notifications.media_type.${mediaType === 'movie' ? 'movie' : 'tv'}`, locale);
}
