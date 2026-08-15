import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { hashPassword } from '../utils/password.js';
import { getAppSettings } from '../utils/appSettings.js';
import { isProviderEnabled } from '../providers/authSettings.js';
import { isMailReady, sendMail } from './mailer.js';
import { logEvent } from '../utils/logEvent.js';

/**
 * Password reset for local accounts.
 *
 * Two rules drive everything here:
 *   1. The response never reveals whether an address has an account. Every outcome — unknown
 *      email, Plex-only account, mail transport down — returns the same success to the caller.
 *   2. Only the SHA-256 of the token is persisted. The raw token exists in the email and nowhere
 *      else, so read access to the database cannot mint a working link.
 */

const TOKEN_BYTES = 32;
const TTL_MS = 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

/** SHA-256, not bcrypt: the token is 256 bits of CSPRNG output, not a human-chosen secret. There
 *  is no dictionary to attack, so a slow KDF would only add latency to every lookup. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function isResetEnabled(): Promise<boolean> {
  const settings = await getAppSettings();
  if (!settings?.passwordResetEnabled) return false;
  // The reset link's origin must come from configuration, never from the request. Deriving it from
  // the Host header would let an attacker POST /password/forgot with `Host: evil.com` and a
  // victim's address: the victim receives a genuine email from this instance carrying a link to
  // the attacker's domain, and clicking it hands over a valid token. So no siteUrl, no feature.
  if (!settings.siteUrl?.trim()) return false;
  // The email provider being off means local login is off; offering to reset a password nobody
  // can use afterwards would be a dead end.
  if (!(await isProviderEnabled('email'))) return false;
  return isMailReady();
}

function resetEmail(siteName: string, link: string, displayName: string) {
  const safeName = displayName.replaceAll(/[<>]/g, '');
  return {
    subject: `[${siteName}] Reset your password`,
    text: [
      `Hi ${safeName},`,
      '',
      `Someone asked to reset the password for your ${siteName} account.`,
      'Open the link below within the hour to choose a new one:',
      '',
      link,
      '',
      "If it wasn't you, ignore this email — your password stays as it is.",
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px">
        <h2 style="margin:0 0 16px">Reset your password</h2>
        <p style="margin:0 0 12px">Hi ${safeName},</p>
        <p style="margin:0 0 16px">Someone asked to reset the password for your ${siteName} account. This link works for one hour.</p>
        <p style="margin:0 0 24px"><a href="${link}" style="background:#6366f1;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Choose a new password</a></p>
        <p style="margin:0;color:#6b7280;font-size:13px">If it wasn't you, ignore this email — your password stays as it is.</p>
      </div>`,
  };
}

/**
 * Always resolves. The caller returns the same response either way — surfacing "no such account"
 * would turn this endpoint into an account-existence oracle.
 */
export async function requestReset(email: string): Promise<void> {
  if (!(await isResetEnabled())) return;

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, displayName: true, passwordHash: true, disabled: true },
  });

  // No passwordHash = the account authenticates through Plex/Jellyfin/Emby/Discord. Setting a
  // password here would quietly create a second way into an account whose owner never asked for one.
  if (!user || !user.passwordHash || user.disabled) return;

  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  // One live token per user: issuing a second must retire the first, or an old email stays usable.
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TTL_MS) },
    }),
  ]);

  const settings = await getAppSettings();
  const siteName = settings?.siteName || 'Oscarr';
  // Configuration only — isResetEnabled already refused when siteUrl is unset, and this re-read
  // keeps the guarantee local to the line that builds the link.
  const base = settings?.siteUrl?.trim().replace(/\/+$/, '');
  if (!base) return;
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendMail({ to: user.email, ...resetEmail(siteName, link, user.displayName ?? user.email) });
    logEvent('info', 'Auth', `Password reset link sent to user ${user.id}`);
  } catch (err) {
    // Swallowed deliberately: a transport failure must not change the caller's response. The admin
    // sees it in the logs; the requester is told the same thing as everyone else.
    logEvent('warn', 'Auth', `Password reset email failed for user ${user.id}: ${(err as Error).message}`);
  }
}

export type ResetError = 'DISABLED' | 'INVALID_TOKEN' | 'PASSWORD_TOO_SHORT';

/** Consumes the token and sets the new password. Returns null on success. */
export async function consumeReset(token: string, password: string): Promise<ResetError | null> {
  if (!(await isResetEnabled())) return 'DISABLED';
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return 'PASSWORD_TOO_SHORT';
  if (typeof token !== 'string' || token.length === 0) return 'INVALID_TOKEN';

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, passwordHash: true, disabled: true } } },
  });
  if (!row) return 'INVALID_TOKEN';

  // The unique index already matched exactly, so this is belt-and-braces against a future lookup
  // that stops being exact — kept constant-time regardless.
  const expected = Buffer.from(row.tokenHash);
  const actual = Buffer.from(hashToken(token));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return 'INVALID_TOKEN';

  if (row.usedAt !== null || row.expiresAt.getTime() < Date.now()) return 'INVALID_TOKEN';
  // Re-checked at consumption: the account may have been disabled, or converted to provider-only,
  // in the hour since the link was issued.
  if (!row.user.passwordHash || row.user.disabled) return 'INVALID_TOKEN';

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    // Any other outstanding link for this user dies with the reset.
    prisma.passwordResetToken.deleteMany({ where: { userId: row.userId, usedAt: null } }),
  ]);

  logEvent('info', 'Auth', `Password reset completed for user ${row.userId}`);
  return null;
}

/** Housekeeping for the daily cleanup job: spent and expired rows have no further use. */
export async function purgeExpiredResets(): Promise<number> {
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  });
  return count;
}
