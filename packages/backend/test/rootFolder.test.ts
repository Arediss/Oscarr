import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression cover for the cross-instance path leak.
 *
 * Root folders are instance-local. A folder rule can set a path without pinning a service, and a
 * quality mapping may then send the request to a different *arr. The path of instance A was handed
 * to instance B, which either rejects it or silently creates an unmanaged directory outside the
 * library — no error, no warning, media on the wrong disk.
 *
 * resolveRootFolder is not exported (it is an implementation detail of sendToArrService), so the
 * behaviour is pinned through the module's own logging and the returned path.
 */

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/logEvent.js', () => ({ logEvent }));

const { resolveRootFolderForTest } = await import('../src/services/requestService.js');

function client(paths: string[], opts: { throws?: boolean } = {}) {
  return {
    getRootFolders: opts.throws
      ? vi.fn().mockRejectedValue(new Error('unreachable'))
      : vi.fn().mockResolvedValue(paths.map((path) => ({ path }))),
    defaultRootFolder: '/fallback',
  };
}

const ctx = (ruleName?: string, serviceId?: number) => ({
  targetService: serviceId ? { id: serviceId, config: {} } : null,
  targetProfileId: null,
  defaultProfileId: null,
  defaultFolder: null,
  ruleMatch: ruleName ? { ruleName, folderPath: '/data/anime', seriesType: null, serviceId: null } : null,
}) as Parameters<typeof resolveRootFolderForTest>[2];

beforeEach(() => logEvent.mockClear());

describe('resolveRootFolder', () => {
  it('keeps the requested path when the target instance has it', async () => {
    const c = client(['/data/tv', '/data/anime']);
    expect(await resolveRootFolderForTest(c, '/data/anime', ctx('Animes'))).toBe('/data/anime');
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('falls back to the instance default when the path is unknown there', async () => {
    const c = client(['/mnt/4k']);
    // This is the leak: the rule asked for a path that only exists on the HD instance.
    expect(await resolveRootFolderForTest(c, '/data/anime', ctx('Animes', 7))).toBe('/mnt/4k');
  });

  it('warns loudly enough for the admin to find the mismatch', async () => {
    const c = client(['/mnt/4k']);
    await resolveRootFolderForTest(c, '/data/anime', ctx('Animes', 7));
    expect(logEvent).toHaveBeenCalledWith('warn', 'FolderRules', expect.stringContaining('/data/anime'));
    const [, , message] = logEvent.mock.calls[0];
    expect(message).toContain('Animes');
    expect(message).toContain('#7');
  });

  it('ignores a trailing slash mismatch — *arr instances are inconsistent about it', async () => {
    const c = client(['/data/anime/']);
    expect(await resolveRootFolderForTest(c, '/data/anime', ctx('Animes'))).toBe('/data/anime/');
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('uses the first root folder when nothing was requested', async () => {
    const c = client(['/data/tv', '/data/anime']);
    expect(await resolveRootFolderForTest(c, null, ctx())).toBe('/data/tv');
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('trusts the configured path when the instance is unreachable', async () => {
    const c = client([], { throws: true });
    // Blocking the request would be worse than trusting configuration that used to be valid.
    expect(await resolveRootFolderForTest(c, '/data/anime', ctx('Animes'))).toBe('/data/anime');
  });

  it('falls back to the client default when the instance reports no root folder at all', async () => {
    const c = client([]);
    expect(await resolveRootFolderForTest(c, null, ctx())).toBe('/fallback');
  });
});
