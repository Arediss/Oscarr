import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { setCache } from '../src/utils/cache.js';

const edge = vi.hoisted(() => ({ sync: vi.fn(), history: vi.fn() }));
vi.mock('../src/services/sync/mediaSync.js', () => ({ syncArrService: edge.sync }));
vi.mock('../src/services/sync/availabilitySync.js', () => ({ syncAvailabilityDates: edge.history }));
const { runFullSync } = await import('../src/services/sync/index.js');

beforeEach(async () => {
  vi.resetAllMocks();
  await prisma.tmdbCache.deleteMany();
  edge.sync.mockResolvedValue({ added: 0, updated: 1, errors: 0, duration: 10 });
  edge.history.mockResolvedValue({ radarrUpdated: 0, sonarrUpdated: 0 });
  for (const key of ['service-metadata:v1:one', 'service-metadata:v1:one:episodes:token:1',
    'tv:60572:season:25:fr', 'trending:all:week:1:fr', 'tv:60572:fr']) {
    await setCache(key, { existing: true });
  }
});

describe('full metadata synchronization', () => {
  it('scans both service types without an incremental cutoff and clears only derived service/season caches', async () => {
    await runFullSync();
    expect(edge.sync.mock.calls).toEqual([['radarr', null], ['sonarr', null]]);
    expect((await prisma.tmdbCache.findMany()).map(row => row.cacheKey).sort())
      .toEqual(['trending:all:week:1:fr', 'tv:60572:fr']);
  });

  it('reports partial failures instead of marking the job successful, and retains the last snapshots', async () => {
    edge.sync.mockResolvedValueOnce({ added: 0, updated: 1, errors: 0, duration: 10 })
      .mockResolvedValueOnce({ added: 0, updated: 2, errors: 1, duration: 10 });
    await expect(runFullSync()).rejects.toThrow('sonarr=1');
    expect(await prisma.tmdbCache.count()).toBe(5);
    expect(edge.history).not.toHaveBeenCalled();
  });
});
