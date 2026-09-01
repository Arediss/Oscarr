import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/utils/prisma.js';
import { loadMasterKeyOrExit, isSensitiveKey, isEncrypted } from '../src/utils/secrets.js';

loadMasterKeyOrExit();

const { updateProviderSettings, getProviderConfig } = await import('../src/providers/authSettings.js');
const { parseNotificationSettings, serializeNotificationSettings } = await import('../src/notifications/providerConfig.js');
const { getAppSettings, patchAppSettings } = await import('../src/utils/appSettings.js');
const { encryptSecretsAtRest } = await import('../src/services/secretsMigration.js');

describe('sensitive key detection', () => {
  // The regression: the old convention anchored on `(^|_)…$`, so every camelCase compound read
  // as non-sensitive — the three secrets that matter most in this app, as it happens.
  it.each([
    ['apiKey', true],
    ['token', true],
    ['password', true],
    ['client_secret', true],
    ['clientSecret', true],
    ['botToken', true],
    ['webhookUrl', true],
    ['clientId', false],
    ['chatId', false],
    ['url', false],
    ['machineId', false],
    ['username', false],
    ['allowSignup', false],
  ])('classifies %s', (key, sensitive) => {
    expect(isSensitiveKey(key)).toBe(sensitive);
  });
});

describe('auth provider config', () => {
  it('stores the OAuth client secret encrypted and reads it back', async () => {
    const secret = `s-${randomUUID()}`;
    await updateProviderSettings('discord', { enabled: true, config: { clientId: 'public-id', clientSecret: secret } });

    const row = await prisma.authProviderSettings.findUnique({ where: { provider: 'discord' } });
    expect(row?.config).not.toContain(secret);
    expect(row?.config).toContain('enc:v1:');
    // Non-secrets stay readable — admins need to debug a config without unlocking it.
    expect(row?.config).toContain('public-id');

    expect(await getProviderConfig('discord')).toMatchObject({ clientId: 'public-id', clientSecret: secret });
  });

  it('keeps a stored secret through an unrelated patch', async () => {
    const secret = `s-${randomUUID()}`;
    await updateProviderSettings('discord', { config: { clientSecret: secret } });
    await updateProviderSettings('discord', { enabled: false });

    expect((await getProviderConfig('discord')).clientSecret).toBe(secret);
  });

  // A value this instance can't decrypt (key rotation, cross-environment restore) reads as ''
  // so ciphertext never reaches an admin form. Merging that '' back on an unrelated toggle
  // would destroy the only copy — the write path merges at the stored level to avoid it.
  it('does not erase an undecryptable secret when toggling the provider', async () => {
    await prisma.authProviderSettings.upsert({
      where: { provider: 'jellyfin' },
      update: { config: JSON.stringify({ clientSecret: 'enc:v1:AAAA.BBBB.CCCC' }) },
      create: { provider: 'jellyfin', enabled: true, config: JSON.stringify({ clientSecret: 'enc:v1:AAAA.BBBB.CCCC' }) },
    });

    await updateProviderSettings('jellyfin', { enabled: false });

    const row = await prisma.authProviderSettings.findUnique({ where: { provider: 'jellyfin' } });
    expect(row?.config).toContain('enc:v1:AAAA.BBBB.CCCC');
    expect(row?.enabled).toBe(false);
  });
});

describe('notification provider settings', () => {
  it('round-trips a webhook and a bot token', () => {
    const settings = { webhookUrl: 'https://discord.example/hook/abc', botToken: '123:secret', chatId: '42' };
    const stored = serializeNotificationSettings(settings);

    expect(stored).not.toContain('discord.example');
    expect(stored).not.toContain('123:secret');
    expect(stored).toContain('42');
    expect(parseNotificationSettings(stored)).toEqual(settings);
  });

  it('survives a plaintext row from before encryption shipped', () => {
    const legacy = JSON.stringify({ webhookUrl: 'https://discord.example/hook/legacy' });
    expect(parseNotificationSettings(legacy)).toEqual({ webhookUrl: 'https://discord.example/hook/legacy' });
  });
});

describe('instance API key', () => {
  it('is encrypted in the row and transparent to callers', async () => {
    const key = randomUUID().replaceAll('-', '');
    await patchAppSettings({ apiKey: key });

    const raw = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { apiKey: true } });
    expect(raw?.apiKey).not.toBe(key);
    expect(isEncrypted(raw?.apiKey)).toBe(true);

    expect((await getAppSettings())?.apiKey).toBe(key);
  });
});

describe('boot sweep', () => {
  it('encrypts rows left in plaintext and leaves the values readable', async () => {
    const secret = `legacy-${randomUUID()}`;
    const providerId = `plugin:test-${randomUUID().slice(0, 8)}`;

    // Write around the encrypting accessors, the way a pre-fix release did.
    await prisma.notificationProviderConfig.create({
      data: { providerId, enabled: true, settings: JSON.stringify({ botToken: secret, chatId: '7' }) },
    });
    await prisma.appSettings.upsert({ where: { id: 1 }, update: { apiKey: secret }, create: { id: 1, apiKey: secret } });

    await encryptSecretsAtRest();

    const row = await prisma.notificationProviderConfig.findUnique({ where: { providerId } });
    expect(row?.settings).not.toContain(secret);
    expect(parseNotificationSettings(row?.settings)).toEqual({ botToken: secret, chatId: '7' });

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { apiKey: true } });
    expect(isEncrypted(settings?.apiKey)).toBe(true);
    expect((await getAppSettings())?.apiKey).toBe(secret);

    // Idempotent: a second pass must not double-wrap.
    await encryptSecretsAtRest();
    expect((await getAppSettings())?.apiKey).toBe(secret);

    await prisma.notificationProviderConfig.delete({ where: { providerId } });
  });
});
