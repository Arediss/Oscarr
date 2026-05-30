import crypto from 'node:crypto';

export const PLAIN_PREFIX = 'oscarr_';
const KEY_BYTES = 32; // 256-bit entropy
const PREFIX_DISPLAY_CHARS = PLAIN_PREFIX.length + 5; // "oscarr_" + 5 hex chars

/** New plaintext key, returned to the caller once and never stored. */
export function generatePlainKey(): string {
  return PLAIN_PREFIX + crypto.randomBytes(KEY_BYTES).toString('hex');
}

/** SHA-256 of the plaintext key. Mint and verify MUST share this so hashes match. */
export function hashKey(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

/** Stored display prefix (e.g. "oscarr_a1b2c") so the UI can tell keys apart. */
export function plainPrefix(plain: string): string {
  return plain.slice(0, PREFIX_DISPLAY_CHARS);
}
