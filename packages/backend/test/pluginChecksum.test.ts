import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { parseSha256File, digestMatches } from '../src/plugins/checksum.js';

/**
 * Every plugin release ships `<asset>.tar.gz.sha256` next to its tarball, and until now nothing
 * read it — the asset filter excluded it from the download choice and that was the end of it.
 */
describe('parseSha256File', () => {
  const digest = 'bb187846a21f46aff3c36da228772489807b982a005a43966670c709d1183bcc';

  it('reads the sha256sum format the release workflow produces', () => {
    expect(parseSha256File(`${digest}  radarr-0.1.6.tar.gz\n`, 'radarr-0.1.6.tar.gz')).toBe(digest);
  });

  it('accepts a bare digest, which some publishers emit', () => {
    expect(parseSha256File(`${digest}\n`, 'radarr-0.1.6.tar.gz')).toBe(digest);
  });

  it('is case-insensitive on the digest and tolerant of single-space separators', () => {
    expect(parseSha256File(`${digest.toUpperCase()} radarr-0.1.6.tar.gz`, 'radarr-0.1.6.tar.gz')).toBe(digest);
  });

  // The whole point is to catch a mismatched pairing, so a checksum describing a different
  // artifact must not silently validate the one we downloaded.
  it('refuses a line that names a different file', () => {
    expect(parseSha256File(`${digest}  sonarr-0.1.5.tar.gz`, 'radarr-0.1.6.tar.gz')).toBeNull();
  });

  it('refuses anything that is not a digest', () => {
    expect(parseSha256File('<!DOCTYPE html><html>404</html>', 'radarr-0.1.6.tar.gz')).toBeNull();
    expect(parseSha256File('', 'radarr-0.1.6.tar.gz')).toBeNull();
    expect(parseSha256File('deadbeef  radarr-0.1.6.tar.gz', 'radarr-0.1.6.tar.gz')).toBeNull();
  });
});

describe('digestMatches', () => {
  const body = Buffer.from('a plugin tarball');
  const digest = createHash('sha256').update(body).digest('hex');

  it('accepts the archive it was computed from', () => {
    expect(digestMatches(body, digest)).toBe(true);
  });

  it('rejects a single flipped byte', () => {
    const tampered = Buffer.from(body);
    tampered[0] ^= 0x01;
    expect(digestMatches(tampered, digest)).toBe(false);
  });

  it('rejects a digest of the wrong length instead of comparing a prefix', () => {
    expect(digestMatches(body, digest.slice(0, 32))).toBe(false);
  });
});
