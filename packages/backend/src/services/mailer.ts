import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { prisma } from '../utils/prisma.js';
import { encryptServiceConfig, decryptServiceConfig } from '../utils/secrets.js';
import { logEvent } from '../utils/logEvent.js';
import { parseNotificationSettings, serializeNotificationSettings } from '../notifications/providerConfig.js';

/**
 * Transactional mail. Distinct from the notification providers on purpose: those broadcast to one
 * fixed admin address, this writes to an arbitrary user (a password reset only ever goes to the
 * person who asked for it).
 *
 * Config resolves environment-first. A compose-only deployment can configure mail without ever
 * opening the panel, and when the env vars are present they win outright — no half-merged state
 * where the panel silently overrides what the operator pinned in their compose file.
 */

export type MailTransport = 'smtp' | 'resend';

export interface MailConfig {
  enabled: boolean;
  transport: MailTransport;
  /** SMTP */
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  /** Resend */
  apiKey: string;
  /** Both. "Oscarr <no-reply@example.com>" or a bare address. */
  fromEmail: string;
  /** True when the values above came from the environment and the panel cannot change them. */
  fromEnv: boolean;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const EMPTY: MailConfig = {
  enabled: false, transport: 'smtp', host: '', port: 587, secure: false,
  user: '', password: '', apiKey: '', fromEmail: '', fromEnv: false,
};

const SEND_TIMEOUT_MS = 15_000;

function envConfig(): MailConfig | null {
  const from = process.env.MAIL_FROM?.trim();
  const smtpHost = process.env.SMTP_HOST?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!from || (!smtpHost && !resendKey)) return null;

  // SMTP wins when both are set: an operator who pinned a host meant it.
  if (smtpHost) {
    const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
    return {
      ...EMPTY,
      enabled: process.env.MAIL_ENABLED !== 'false',
      transport: 'smtp',
      host: smtpHost,
      port: Number.isFinite(port) ? port : 587,
      // Implicit TLS on 465, STARTTLS elsewhere — the usual convention, overridable.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      user: process.env.SMTP_USER?.trim() ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
      fromEmail: from,
      fromEnv: true,
    };
  }

  return {
    ...EMPTY,
    enabled: process.env.MAIL_ENABLED !== 'false',
    transport: 'resend',
    apiKey: resendKey!,
    fromEmail: from,
    fromEnv: true,
  };
}

function coerce(raw: Record<string, string>, enabled: boolean, transport: string): MailConfig {
  const port = Number.parseInt(raw.port ?? '587', 10);
  return {
    enabled,
    transport: transport === 'resend' ? 'resend' : 'smtp',
    host: raw.host ?? '',
    port: Number.isFinite(port) ? port : 587,
    secure: raw.secure === 'true',
    user: raw.user ?? '',
    password: raw.password ?? '',
    apiKey: raw.apiKey ?? '',
    fromEmail: raw.fromEmail ?? '',
    fromEnv: false,
  };
}

/** Full config including secrets. Never hand this to a route response — see redactMailConfig. */
export async function getMailConfig(): Promise<MailConfig> {
  const fromEnv = envConfig();
  if (fromEnv) return fromEnv;

  const row = await prisma.mailConfig.findUnique({ where: { id: 1 } });
  if (!row) return EMPTY;

  let raw: Record<string, string> = {};
  try {
    raw = decryptServiceConfig(JSON.parse(row.config) as Record<string, string>);
  } catch (err) {
    // An undecryptable blob (rotated OSCARR_SECRET_KEY) must disable mail, not send with blanks.
    logEvent('warn', 'Mail', `Mail config unreadable, transport disabled: ${(err as Error).message}`);
    return EMPTY;
  }
  return coerce(raw, row.enabled, row.transport);
}

/** Panel-safe view: booleans and non-secret fields only, plus whether a secret is on file. */
export function redactMailConfig(config: MailConfig) {
  return {
    enabled: config.enabled,
    transport: config.transport,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    fromEmail: config.fromEmail,
    fromEnv: config.fromEnv,
    hasPassword: config.password.length > 0,
    hasApiKey: config.apiKey.length > 0,
    configured: isConfigured(config),
  };
}

export function isConfigured(config: MailConfig): boolean {
  if (!config.fromEmail) return false;
  return config.transport === 'smtp' ? config.host.length > 0 : config.apiKey.length > 0;
}

/** Mail is usable: turned on and actually configured. */
export async function isMailReady(): Promise<boolean> {
  const config = await getMailConfig();
  return config.enabled && isConfigured(config);
}

export async function saveMailConfig(input: {
  enabled?: boolean;
  transport?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  apiKey?: string;
  fromEmail?: string;
}): Promise<void> {
  const current = await prisma.mailConfig.findUnique({ where: { id: 1 } });
  let raw: Record<string, string> = {};
  if (current) {
    try { raw = decryptServiceConfig(JSON.parse(current.config) as Record<string, string>); } catch { raw = {}; }
  }

  const merged: Record<string, string> = { ...raw };
  if (input.host !== undefined) merged.host = input.host.trim();
  if (input.port !== undefined) merged.port = String(input.port);
  if (input.secure !== undefined) merged.secure = String(input.secure);
  if (input.user !== undefined) merged.user = input.user.trim();
  if (input.fromEmail !== undefined) merged.fromEmail = input.fromEmail.trim();
  // Secrets: an absent field keeps what is stored, an empty string clears it. Without this the
  // panel would have to echo the secret back just to let the admin change the port.
  if (input.password !== undefined) merged.password = input.password;
  if (input.apiKey !== undefined) merged.apiKey = input.apiKey;

  await prisma.mailConfig.upsert({
    where: { id: 1 },
    update: {
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.transport !== undefined && { transport: input.transport === 'resend' ? 'resend' : 'smtp' }),
      config: JSON.stringify(encryptServiceConfig(merged)),
    },
    create: {
      id: 1,
      enabled: input.enabled ?? false,
      transport: input.transport === 'resend' ? 'resend' : 'smtp',
      config: JSON.stringify(encryptServiceConfig(merged)),
    },
  });
}

/**
 * One-shot adoption of the pre-0.8.9 layout, where the email notification provider carried its own
 * Resend key and From address — in plaintext, since provider settings are not encrypted. Moves both
 * into the shared transport (encrypted) and strips them from the provider row, leaving it with just
 * the recipient. Idempotent and safe to run on every boot.
 */
export async function adoptLegacyEmailProviderConfig(): Promise<void> {
  const legacy = await prisma.notificationProviderConfig.findUnique({ where: { providerId: 'email' } });
  if (!legacy) return;

  const settings: Record<string, unknown> = parseNotificationSettings(legacy.settings);
  const apiKey = typeof settings.apiKey === 'string' ? settings.apiKey : '';
  const fromEmail = typeof settings.fromEmail === 'string' ? settings.fromEmail : '';
  if (!apiKey && !fromEmail) return;

  const existing = await prisma.mailConfig.findUnique({ where: { id: 1 } });
  let alreadyConfigured = false;
  if (existing) {
    try {
      const raw = decryptServiceConfig(JSON.parse(existing.config) as Record<string, string>);
      alreadyConfigured = Boolean(raw.apiKey || raw.host);
    } catch { /* unreadable blob — treat as unconfigured and let the legacy values seed it */ }
  }

  // Never clobber a transport the admin already set up here; just clear the stale plaintext.
  if (!alreadyConfigured) {
    await saveMailConfig({
      transport: 'resend',
      apiKey,
      fromEmail,
      // Deliberately left disabled: adopting a credential is not consent to start sending. The
      // admin turns it on in Admin → System → Mail after checking it.
      enabled: false,
    });
  }

  const { apiKey: _dropKey, fromEmail: _dropFrom, ...rest } = settings;
  await prisma.notificationProviderConfig.update({
    where: { providerId: 'email' },
    data: { settings: serializeNotificationSettings(rest as Record<string, string>) },
  });
  logEvent('info', 'Mail', alreadyConfigured
    ? 'Removed the legacy plaintext Resend credential from the email notification provider'
    : 'Adopted the legacy Resend credential into the shared mail transport (left disabled — review it in Admin → System → Mail)');
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${SEND_TIMEOUT_MS}ms`)), SEND_TIMEOUT_MS).unref?.(),
    ),
  ]);
}

async function deliver(config: MailConfig, message: MailMessage): Promise<void> {
  if (config.transport === 'resend') {
    const resend = new Resend(config.apiKey);
    const { error } = await withTimeout(
      resend.emails.send({
        from: config.fromEmail,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      'Resend send',
    );
    // The SDK reports failures in the payload rather than throwing, so a bad key looks like
    // success unless this is checked.
    if (error) throw new Error(error.message);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  try {
    await withTimeout(transporter.sendMail({
      from: config.fromEmail,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }), 'SMTP send');
  } finally {
    transporter.close();
  }
}

/** Throws on failure — callers that must not leak whether an address exists catch and swallow. */
export async function sendMail(message: MailMessage): Promise<void> {
  const config = await getMailConfig();
  if (!config.enabled) throw new Error('Mail transport is disabled');
  if (!isConfigured(config)) throw new Error('Mail transport is not configured');
  await deliver(config, message);
}

/** Admin "test" button. Uses the submitted config so the admin can verify before saving. */
export async function testMailConfig(config: MailConfig, to: string): Promise<void> {
  if (!isConfigured(config)) throw new Error('Mail transport is not configured');
  await deliver(config, {
    to,
    subject: '[Oscarr] Test email',
    html: '<h2>It works</h2><p>Oscarr can send mail with this configuration.</p>',
    text: 'It works. Oscarr can send mail with this configuration.',
  });
}
