import { encryptSecretFields, decryptSecretFields } from '../utils/secrets.js';

/** Read/write side of `NotificationProviderConfig.settings`.
 *
 *  That column holds the Discord webhook URL, the Telegram bot token, and whatever a plugin
 *  provider asks for — all of it was stored as plaintext JSON, so anyone with the database file
 *  (or an unencrypted backup archive) could post as the instance. Same AES-256-GCM treatment as
 *  `Service.config` now, keyed on the same field-name convention. */
export function parseNotificationSettings(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return decryptSecretFields(parsed as Record<string, string>);
  } catch {
    return {};
  }
}

export function serializeNotificationSettings(settings: Record<string, string>): string {
  return JSON.stringify(encryptSecretFields(settings));
}

/** The settings column exactly as stored — still encrypted. Needed by the save path, which has to
 *  merge onto the stored blob rather than onto a decrypted copy: an empty decrypt sentinel merged
 *  back would erase the very credential it stands in for. */
export function parseRawNotificationSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
