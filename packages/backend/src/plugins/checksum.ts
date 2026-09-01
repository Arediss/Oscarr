import { createHash, timingSafeEqual } from 'node:crypto';

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Read a `.sha256` sidecar. Accepts the two shapes publishers actually emit: `sha256sum` output
 * (`<digest>  <filename>`) and a bare digest.
 *
 * When the file names a filename, it must be the archive we downloaded — a checksum that
 * describes a different artifact validates nothing, and accepting it would defeat the purpose.
 * Returns the lowercase digest, or null when the content isn't a usable checksum (a 404 HTML
 * body lands here too).
 */
export function parseSha256File(content: string, expectedFilename: string): string | null {
  const line = content.split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;

  const [digest, ...rest] = line.split(/\s+/);
  if (!SHA256_HEX.test(digest)) return null;

  const named = rest.join(' ').replace(/^\*/, '').trim();
  if (named && named !== expectedFilename) return null;

  return digest.toLowerCase();
}

/** Constant-time comparison of an archive against an expected hex digest. */
export function digestMatches(archive: Buffer, expectedHex: string): boolean {
  if (!SHA256_HEX.test(expectedHex)) return false;
  const actual = createHash('sha256').update(archive).digest();
  const expected = Buffer.from(expectedHex.toLowerCase(), 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
