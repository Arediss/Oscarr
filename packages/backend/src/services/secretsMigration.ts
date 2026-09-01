import { prisma } from '../utils/prisma.js';
import { logEvent } from '../utils/logEvent.js';
import { encryptSecretFields, encryptSecretValue, hasPlaintextSecret, isEncrypted } from '../utils/secrets.js';

/**
 * Bring stored credentials up to the current encryption-at-rest rules. Idempotent and cheap —
 * runs on every boot, writes only rows that still hold a plaintext secret.
 *
 * Two things this catches:
 *   • Tables that were never encrypted at all — auth provider configs (Discord client secret),
 *     notification provider settings (Discord webhook, Telegram bot token), linked-account
 *     OAuth tokens, and the instance API key. All of them sat in the database, and in every
 *     backup archive, in the clear.
 *   • Rows written before `isSensitiveKey` learned to split camelCase. `clientSecret`,
 *     `botToken` and `webhookUrl` used to read as non-sensitive, so even the encrypting write
 *     paths stored them as plaintext.
 */
export async function encryptSecretsAtRest(): Promise<void> {
  let rewritten = 0;

  const parseBlob = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  };

  const needsWork = (blob: Record<string, unknown>) => hasPlaintextSecret(blob as Record<string, string>);

  for (const row of await prisma.authProviderSettings.findMany()) {
    const blob = parseBlob(row.config);
    if (!blob || !needsWork(blob)) continue;
    await prisma.authProviderSettings.update({
      where: { id: row.id },
      data: { config: JSON.stringify(encryptSecretFields(blob)) },
    });
    rewritten++;
  }

  for (const row of await prisma.notificationProviderConfig.findMany()) {
    const blob = parseBlob(row.settings);
    if (!blob || !needsWork(blob)) continue;
    await prisma.notificationProviderConfig.update({
      where: { id: row.id },
      data: { settings: JSON.stringify(encryptSecretFields(blob)) },
    });
    rewritten++;
  }

  // Services were already encrypted on write, but only for the field names the old convention
  // recognised — sweep them too so a camelCase key doesn't stay behind.
  for (const row of await prisma.service.findMany()) {
    const blob = parseBlob(row.config);
    if (!blob || !needsWork(blob)) continue;
    await prisma.service.update({
      where: { id: row.id },
      data: { config: JSON.stringify(encryptSecretFields(blob)) },
    });
    rewritten++;
  }

  const linkedAccounts = await prisma.userProvider.findMany({
    where: { providerToken: { not: null } },
    select: { id: true, providerToken: true },
  });
  for (const account of linkedAccounts) {
    if (!account.providerToken || isEncrypted(account.providerToken)) continue;
    await prisma.userProvider.update({
      where: { id: account.id },
      data: { providerToken: encryptSecretValue(account.providerToken) },
    });
    rewritten++;
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { apiKey: true } });
  if (settings?.apiKey && !isEncrypted(settings.apiKey)) {
    await prisma.appSettings.update({ where: { id: 1 }, data: { apiKey: encryptSecretValue(settings.apiKey) } });
    rewritten++;
  }

  if (rewritten > 0) {
    logEvent('info', 'Security', `Encrypted ${rewritten} stored credential${rewritten === 1 ? '' : 's'} that were still in plaintext`);
  }
}
