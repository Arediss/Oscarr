import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { loadMasterKeyOrExit } from '../src/utils/secrets.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
import { startSmtpSink, type SmtpSink } from './helpers/smtpSink.js';

loadMasterKeyOrExit();

const { saveMailConfig, getMailConfig, redactMailConfig } = await import('../src/services/mailer.js');
const { requestReset, consumeReset, isResetEnabled, purgeExpiredResets } = await import('../src/services/passwordReset.js');

let sink: SmtpSink;
let localId: number;
let providerOnlyId: number;
const localEmail = 'local@test.local';
const providerEmail = 'plex@test.local';

/** The reset link is in the delivered body; quoted-printable may wrap it and escape '='. */
function tokenFrom(raw: string | undefined): string | null {
  if (!raw) return null;
  const unfolded = raw.replace(/=\r?\n/g, '');
  const m = /reset-password\?token=(?:3D)?([A-Za-z0-9_-]+)/.exec(unfolded);
  return m ? m[1] : null;
}

async function lastToken(): Promise<string> {
  await requestReset(localEmail);
  // The transport is a real socket; give the delivery a beat to land.
  await new Promise((r) => setTimeout(r, 300));
  const token = tokenFrom(sink.received.at(-1));
  if (!token) throw new Error('no reset link was delivered');
  return token;
}

beforeAll(async () => {
  sink = await startSmtpSink();
  await saveMailConfig({
    enabled: true, transport: 'smtp', host: '127.0.0.1', port: sink.port,
    secure: false, user: '', password: '', fromEmail: 'Oscarr <no-reply@test.local>',
  });
});

beforeEach(async () => {
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany({ where: { email: { in: [localEmail, providerEmail] } } });
  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: { passwordResetEnabled: true, siteName: 'Oscarr', siteUrl: 'https://oscarr.test' },
    create: { id: 1, passwordResetEnabled: true, siteName: 'Oscarr', siteUrl: 'https://oscarr.test' },
  });
  await prisma.authProviderSettings.upsert({
    where: { provider: 'email' },
    update: { enabled: true },
    create: { provider: 'email', enabled: true, config: '{}' },
  });

  localId = (await prisma.user.create({
    data: { email: localEmail, displayName: 'Local', passwordHash: await hashPassword('originalpass'), role: 'user' },
  })).id;
  providerOnlyId = (await prisma.user.create({
    data: { email: providerEmail, displayName: 'Plex', passwordHash: null, role: 'user' },
  })).id;
  sink.received.length = 0;
});

afterAll(async () => {
  sink.close();
  await prisma.$disconnect();
});

describe('mail transport', () => {
  it('never stores the SMTP password in clear text', async () => {
    await saveMailConfig({ password: 'super-secret' });
    const row = await prisma.mailConfig.findUnique({ where: { id: 1 } });
    expect(row!.config).not.toContain('super-secret');
    expect((await getMailConfig()).password).toBe('super-secret');
  });

  it('keeps secrets out of the panel view', async () => {
    const view = redactMailConfig(await getMailConfig());
    expect(view).not.toHaveProperty('password');
    expect(view).not.toHaveProperty('apiKey');
    expect(view.hasPassword).toBe(true);
  });

  it('treats an empty secret as "clear it" and an absent one as "keep it"', async () => {
    await saveMailConfig({ password: '' });
    expect((await getMailConfig()).password).toBe('');
    await saveMailConfig({ password: 'kept' });
    await saveMailConfig({ port: 2525 });
    expect((await getMailConfig()).password).toBe('kept');
    await saveMailConfig({ password: '', port: sink.port });
  });

  it('lets the environment override the stored config entirely', async () => {
    process.env.SMTP_HOST = 'env.example.com';
    process.env.SMTP_PORT = '465';
    process.env.MAIL_FROM = 'Env <env@example.com>';
    try {
      const cfg = await getMailConfig();
      expect(cfg.host).toBe('env.example.com');
      expect(cfg.fromEnv).toBe(true);
      // Port 465 means implicit TLS by convention.
      expect(cfg.secure).toBe(true);
    } finally {
      delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; delete process.env.MAIL_FROM;
    }
    expect((await getMailConfig()).host).toBe('127.0.0.1');
  });
});

describe('password reset — nominal', () => {
  it('delivers a link and changes the password', async () => {
    const token = await lastToken();
    expect(await consumeReset(token, 'brandnewpass')).toBeNull();

    const user = await prisma.user.findUnique({ where: { id: localId } });
    expect(await verifyPassword('brandnewpass', user!.passwordHash!)).toBe(true);
    expect(await verifyPassword('originalpass', user!.passwordHash!)).toBe(false);
  });

  it('stores only a hash of the token', async () => {
    const token = await lastToken();
    const row = await prisma.passwordResetToken.findFirst({ where: { userId: localId } });
    expect(row!.tokenHash).not.toBe(token);
    expect(sink.received.at(-1)).not.toContain(row!.tokenHash);
  });

  it('builds the link from siteUrl, never from the request', async () => {
    await lastToken();
    expect(sink.received.at(-1)!.replace(/=\r?\n/g, '')).toContain('https://oscarr.test/reset-password');
  });
});

describe('password reset — token lifecycle', () => {
  it('refuses a reused token', async () => {
    const token = await lastToken();
    expect(await consumeReset(token, 'firstpass')).toBeNull();
    expect(await consumeReset(token, 'secondpass')).toBe('INVALID_TOKEN');
  });

  it('refuses an unknown token', async () => {
    expect(await consumeReset('nonsense', 'whatever12')).toBe('INVALID_TOKEN');
  });

  it('invalidates the previous link when a new one is requested', async () => {
    const first = await lastToken();
    const second = await lastToken();
    expect(await consumeReset(first, 'firstpass')).toBe('INVALID_TOKEN');
    expect(await consumeReset(second, 'secondpass')).toBeNull();
  });

  it('refuses an expired token', async () => {
    const token = await lastToken();
    await prisma.passwordResetToken.updateMany({
      where: { userId: localId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await consumeReset(token, 'expiredpass')).toBe('INVALID_TOKEN');
  });

  it('keeps the token alive after a rejected password', async () => {
    const token = await lastToken();
    expect(await consumeReset(token, 'short')).toBe('PASSWORD_TOO_SHORT');
    expect(await consumeReset(token, 'longenough1')).toBeNull();
  });

  it('purges spent and expired rows', async () => {
    const token = await lastToken();
    await consumeReset(token, 'donepass123');
    expect(await purgeExpiredResets()).toBeGreaterThan(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: localId } })).toBe(0);
  });
});

/** The response is identical in every branch — otherwise this endpoint tells an attacker which
 *  addresses have accounts. The only observable is whether a mail was actually sent. */
describe('password reset — account enumeration', () => {
  it('sends nothing for an account without a password', async () => {
    await requestReset(providerEmail);
    await new Promise((r) => setTimeout(r, 250));
    expect(sink.received).toHaveLength(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: providerOnlyId } })).toBe(0);
  });

  it('sends nothing for an unknown address', async () => {
    await requestReset('nobody@test.local');
    await new Promise((r) => setTimeout(r, 250));
    expect(sink.received).toHaveLength(0);
  });

  it('sends nothing for a disabled account', async () => {
    await prisma.user.update({ where: { id: localId }, data: { disabled: true } });
    await requestReset(localEmail);
    await new Promise((r) => setTimeout(r, 250));
    expect(sink.received).toHaveLength(0);
  });
});

describe('password reset — kill switches', () => {
  it('is off when the feature flag is off', async () => {
    await prisma.appSettings.update({ where: { id: 1 }, data: { passwordResetEnabled: false } });
    expect(await isResetEnabled()).toBe(false);
    await requestReset(localEmail);
    await new Promise((r) => setTimeout(r, 250));
    expect(sink.received).toHaveLength(0);
    expect(await consumeReset('x', 'whatever12')).toBe('DISABLED');
  });

  it('is off when the email provider is disabled', async () => {
    await prisma.authProviderSettings.update({ where: { provider: 'email' }, data: { enabled: false } });
    expect(await isResetEnabled()).toBe(false);
  });

  it('is off when the mail transport is disabled', async () => {
    await saveMailConfig({ enabled: false });
    expect(await isResetEnabled()).toBe(false);
    await saveMailConfig({ enabled: true });
  });

  /** Host-header poisoning: without a configured origin there is no safe link to build, so the
   *  feature refuses rather than trusting whatever host the request carried. */
  it('is off when siteUrl is not configured', async () => {
    await prisma.appSettings.update({ where: { id: 1 }, data: { siteUrl: null } });
    expect(await isResetEnabled()).toBe(false);
    await requestReset(localEmail);
    await new Promise((r) => setTimeout(r, 250));
    expect(sink.received).toHaveLength(0);
  });
});
