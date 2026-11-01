import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTvSeasonDetails } from '../src/services/tmdb.js';

const http = vi.hoisted(() => ({ get: vi.fn() }));
const cache = vi.hoisted(() => ({ getCached: vi.fn(), setCache: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http } }));
vi.mock('../src/utils/cache.js', () => cache);
vi.mock('../src/utils/fetchWithRetry.js', () => ({ attachAxiosRetry: (client: unknown) => client }));

beforeEach(() => {
  vi.resetAllMocks();
  http.get.mockResolvedValue({ data: { episodes: [] } });
});

describe('TMDB season resource validation', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648, '../movie/1', '//example.invalid'])(
    'rejects an invalid series ID before cache or HTTP access: %s', async value => {
      await expect(getTvSeasonDetails(value as number, 1)).rejects.toThrow('Invalid TMDB series ID');
      expect(cache.getCached).not.toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648, '../credits', '?language=fr', null])(
    'rejects an invalid season before cache or HTTP access: %s', async value => {
      await expect(getTvSeasonDetails(1411, value as number)).rejects.toThrow('Invalid TMDB season number');
      expect(cache.getCached).not.toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
    },
  );

  it.each([0, 5, 2147483647])('loads a valid season, including specials: %s', async season => {
    await expect(getTvSeasonDetails(1411, season)).resolves.toEqual({ episodes: [] });
    expect(http.get).toHaveBeenCalledExactlyOnceWith(`/tv/1411/season/${season}`);
    expect(cache.setCache).toHaveBeenCalledWith(`tv:1411:season:${season}:en`, { episodes: [] }, 24);
  });
});
