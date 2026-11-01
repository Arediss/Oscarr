import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SonarrClient } from '../src/providers/sonarr/client.js';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http } }));
vi.mock('../src/utils/fetchWithRetry.js', () => ({ attachAxiosRetry: (client: unknown) => client }));

beforeEach(() => {
  vi.resetAllMocks();
  http.get.mockImplementation(async (path: string) => ({ data: path.startsWith('/series/') ? {
    id: 42, monitored: false, path: '/tv/show', qualityProfileId: 9,
    seasons: [{ seasonNumber: 0, monitored: false }, { seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: false }, { seasonNumber: 3, monitored: false }],
  } : [{ id: 21, monitored: false }, { id: 22, monitored: true }] }));
});

describe('Sonarr season dispatch', () => {
  it('preserves other seasons and settings while monitoring and searching the requested season', async () => {
    await new SonarrClient('http://sonarr.test', 'test').requestSeasons(42, [2, 2]);
    expect(http.post).toHaveBeenCalledWith('/seasonpass', {
      series: [{ id: 42, monitored: true, seasons: [{ seasonNumber: 2, monitored: true }] }],
    });
    expect(http.get).toHaveBeenCalledWith('/episode', { params: { seriesId: 42, seasonNumber: 2 } });
    expect(http.put).toHaveBeenCalledWith('/episode/monitor', { episodeIds: [21], monitored: true });
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.post).toHaveBeenCalledWith('/command', { name: 'SeasonSearch', seriesId: 42, seasonNumber: 2 });
  });
  it('rejects an unknown season before changing Sonarr', async () => {
    await expect(new SonarrClient('http://sonarr.test', 'test').requestSeasons(42, [99])).rejects.toThrow();
    expect(http.put).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });
  it('does not search when monitoring failed', async () => {
    http.post.mockRejectedValueOnce(new Error('unavailable'));
    await expect(new SonarrClient('http://sonarr.test', 'test').requestSeasons(42, [2])).rejects.toThrow();
    expect(http.post).not.toHaveBeenCalledWith('/command', expect.anything());
  });
});
