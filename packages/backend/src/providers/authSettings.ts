import { prisma } from '../utils/prisma.js';
import { encryptSecretFields, decryptSecretFields } from '../utils/secrets.js';

/**
 * Auth provider settings are stored in AuthProviderSettings (migration 20260418203028).
 * Upsert-on-read means a brand-new provider (added to code after initial migration) gets a
 * disabled row automatically on first query — no manual seed needed.
 */

export interface AuthProviderSettingsRow {
  enabled: boolean;
  config: Record<string, unknown>;
}

/** Read (or create-then-read) a provider's settings row. */
export async function getProviderSettings(providerId: string): Promise<AuthProviderSettingsRow> {
  const row = await prisma.authProviderSettings.upsert({
    where: { provider: providerId },
    update: {},
    create: { provider: providerId, enabled: false, config: '{}' },
  });
  return { enabled: row.enabled, config: safeParseConfig(row.config) };
}

/** Just the JSON config — use when you need a specific field. */
export async function getProviderConfig(providerId: string): Promise<Record<string, unknown>> {
  const { config } = await getProviderSettings(providerId);
  return config;
}

/** True if the provider's enabled flag is set. Use before running auth/register/callback logic
 *  so the admin's "disable" toggle actually blocks the routes, not just the login-page buttons. */
export async function isProviderEnabled(providerId: string): Promise<boolean> {
  const { enabled } = await getProviderSettings(providerId);
  return enabled;
}

/** Every row, for the admin UI grid. */
export async function listAllProviderSettings(): Promise<
  Array<{ provider: string; enabled: boolean; config: Record<string, unknown> }>
> {
  const rows = await prisma.authProviderSettings.findMany({ orderBy: { provider: 'asc' } });
  return rows.map((r) => ({ provider: r.provider, enabled: r.enabled, config: safeParseConfig(r.config) }));
}

/**
 * Patch a provider's row. `config` is merged shallowly with the existing blob so the UI can
 * PATCH a single field without sending the whole config back.
 */
export async function updateProviderSettings(
  providerId: string,
  patch: { enabled?: boolean; config?: Record<string, unknown> }
): Promise<void> {
  // Merge onto the blob as stored, not as decrypted. Decryption failures collapse to '' by
  // design (so ciphertext never lands in an admin form), and merging that back would let a
  // `{ enabled: false }` toggle silently erase a credential this instance simply can't read —
  // after a key rotation or a cross-environment restore. Untouched fields are carried over
  // verbatim; only what the caller actually sent is re-encrypted.
  const row = await prisma.authProviderSettings.upsert({
    where: { provider: providerId },
    update: {},
    create: { provider: providerId, enabled: false, config: '{}' },
  });
  const storedConfig = parseRawConfig(row.config);
  const nextConfig = patch.config ? { ...storedConfig, ...encryptSecretFields(patch.config) } : storedConfig;
  const stored = JSON.stringify(nextConfig);
  await prisma.authProviderSettings.upsert({
    where: { provider: providerId },
    update: {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      config: stored,
    },
    create: {
      provider: providerId,
      enabled: patch.enabled ?? false,
      config: stored,
    },
  });
}

/** Parse without decrypting — the write path merges at this level so it never has to round-trip
 *  a value it couldn't read. */
function parseRawConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Parse + decrypt. The blob holds OAuth client secrets (Discord's above all), which used to sit
 *  here as plaintext JSON — readable in the database file and in every backup archive. Sensitive
 *  fields are AES-256-GCM at rest now, on the same field-name convention as Service configs. */
function safeParseConfig(raw: string): Record<string, unknown> {
  return decryptSecretFields(parseRawConfig(raw));
}
