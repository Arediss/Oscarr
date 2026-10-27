import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SonarrClient } from '../src/providers/sonarr/client.js';
import { RadarrClient } from '../src/providers/radarr/client.js';

const http = vi.hoisted(() => ({ put: vi.fn(async () => ({ data: [] })), get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http } }));
vi.mock('../src/utils/fetchWithRetry.js', () => ({ attachAxiosRetry: (client: unknown) => client }));
beforeEach(() => vi.clearAllMocks());

describe('additive tag updates', () => {
  it('rejects malformed upstream tags before exposing the normalized contract', async () => {
    const client = new SonarrClient('http://sonarr.test', 'test');
    for (const data of [null, {}, [{ id: '7', label: 'VOSTFR' }], [{ id: -1, label: 'VOSTFR' }], [{ id: 7, label: '' }]]) {
      http.get.mockResolvedValue({ data });
      await expect(client.getTags()).rejects.toThrow('Invalid service tag response');
    }
    http.get.mockResolvedValue({ data: [{ id: 7, label: 'VOSTFR', extra: 'upstream' }] });
    expect(await client.getTags()).toEqual([{ id: 7, label: 'VOSTFR' }]);
  });
  it('adds Sonarr tags without replacing tags or series settings', async () => {
    await new SonarrClient('http://sonarr.test', 'test').addTagsToMedia(42, [7, 9]);
    expect(http.put).toHaveBeenCalledWith('/series/editor', { seriesIds: [42], tags: [7, 9], applyTags: 'add' });
  });
  it('adds Radarr tags without replacing tags or movie settings', async () => {
    await new RadarrClient('http://radarr.test', 'test').addTagsToMedia(42, [7, 9]);
    expect(http.put).toHaveBeenCalledWith('/movie/editor', { movieIds: [42], tags: [7, 9], applyTags: 'add' });
  });
});
