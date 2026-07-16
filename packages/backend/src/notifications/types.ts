import type { NotificationLocale } from '@oscarr/shared';

/**
 * A field definition for a provider's configuration form.
 * The admin UI renders these dynamically.
 */
export interface ProviderSettingField {
  key: string;
  labelKey: string;       // i18n key, e.g. "admin.notifications.provider.discord.webhook_url"
  type: 'text' | 'password';
  placeholder?: string;
  required?: boolean;
}

/**
 * The payload passed to every notification provider on send.
 */
export interface NotificationPayload {
  type: string;
  label?: string;          // resolved by the registry, already localized to the instance language
  title: string;
  mediaType?: 'movie' | 'tv';
  username?: string;
  posterPath?: string | null;
  tmdbId?: number;
  message?: string;
  color?: number;
  url?: string;
  language?: NotificationLocale; // instance language, resolved once in registry.send
}

/**
 * A registered event type that appears in the notification matrix.
 */
export interface NotificationEventType {
  key: string;
  label: string;          // Human-readable fallback label for push notifications
  labelKey: string;       // i18n key for admin UI display
  color?: number;         // Hex color for embeds (Discord, etc.)
}

/**
 * Interface that every notification provider must implement.
 * Core providers and plugin providers share this contract.
 */
export interface NotificationProvider {
  /** Unique identifier, e.g. "discord", "telegram", "my-plugin-slack" */
  id: string;

  /** i18n key for the display name shown in admin UI */
  nameKey: string;

  /** Lucide icon name, e.g. "MessageCircle", "Mail", "Bell" */
  icon: string;

  /** Setting fields rendered in the admin config modal */
  settingsSchema: ProviderSettingField[];

  /**
   * Send a notification. Receives the resolved settings from the DB
   * and the event payload.
   */
  send(settings: Record<string, string>, payload: NotificationPayload): Promise<void>;

  /**
   * Test the connection with given credentials. `locale` is the resolved instance language so the
   * test message respects it (optional for backward-compat with plugin providers).
   * Throws on failure.
   */
  testConnection(settings: Record<string, string>, locale?: NotificationLocale): Promise<void>;
}
