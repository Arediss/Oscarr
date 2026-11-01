import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SonarrClient } from '../src/providers/sonarr/client.js';
import { RadarrClient } from '../src/providers/radarr/client.js';
import type { ArrClient } from '../src/providers/types.js';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http } }));
vi.mock('../src/utils/fetchWithRetry.js', () => ({ attachAxiosRetry: (client: unknown) => client }));
const identity = { tmdbId: 299255 };
const series = { id: 44, title: 'Minimum Security', tmdbId: 299255, tvdbId: 476017,
  overview: 'Native overview', firstAired: '2026-04-05T00:00:00Z', runtime: 45, monitored: true,
  images: [{ coverType: 'poster', remoteUrl: 'https://artworks.thetvdb.com/native.jpg' }],
  seasons: [{ seasonNumber: 1, monitored: true, statistics: { totalEpisodeCount: 8, episodeFileCount: 8 } }] };
const lookup = (client: ArrClient) => client.lookupMetadata!(identity);
beforeEach(() => vi.resetAllMocks());

describe('service-owned metadata', () => {
  it('resolves Sonarr by TMDB without depending on a TMDB external-ID mapping', async () => {
    http.get.mockImplementation(async (url: string) => ({ data: url === '/series/lookup' ? [series] : [series] }));
    const result = await lookup(new SonarrClient('http://sonarr', 'test'));
    expect(http.get).toHaveBeenCalledWith('/series/lookup', { params: { term: 'tmdb:299255' } });
    expect(result).toMatchObject({ ...identity, tvdbId: 476017, serviceMediaId: 44, title: 'Minimum Security',
      overview: 'Native overview', posterPath: 'https://artworks.thetvdb.com/native.jpg', runtime: 45,
      seasonCatalog: { tracked: true, numbering: 'tvdb:official', seasons: [{ seasonNumber: 1, episodeCount: 8 }] } });
    expect(http.post).not.toHaveBeenCalled();
    expect(http.put).not.toHaveBeenCalled();
  });

  it('uses tracked Sonarr metadata directly when a TVDB identity is already known', async () => {
    http.get.mockResolvedValue({ data: [series] });
    const result = await new SonarrClient('http://sonarr', 'test').lookupMetadata!({ ...identity, tvdbId: 476017 });
    expect(result?.title).toBe('Minimum Security');
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith('/series', { params: { tvdbId: 476017, includeSeasonImages: true } });
  });

  it.each([
    [{ ...series, tmdbId: 1 }], [{ ...series, tvdbId: 0 }], [{ ...series, tmdbId: undefined }],
    [series, { ...series, tvdbId: 2 }],
  ])('rejects an invalid or ambiguous Sonarr identity (%j)', async data => {
    http.get.mockResolvedValue({ data });
    await expect(lookup(new SonarrClient('http://sonarr', 'test'))).rejects.toThrow();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('returns null when Sonarr cannot resolve the exact title', async () => {
    http.get.mockResolvedValue({ data: [] });
    expect(await lookup(new SonarrClient('http://sonarr', 'test'))).toBeNull();
  });

  it('reads Radarr movie metadata without a discovery lookup or a write', async () => {
    http.get.mockResolvedValue({ data: [{ id: 98, tmdbId: 299255, title: 'Native movie', overview: 'Radarr summary',
      runtime: 100, inCinemas: '2026-02-02T00:00:00Z', images: [{ coverType: 'fanart', remoteUrl: 'https://image.tmdb.org/t/p/original/background.jpg' }] }] });
    expect(await lookup(new RadarrClient('http://radarr', 'test'))).toMatchObject({ tmdbId: 299255, tvdbId: null,
      serviceMediaId: 98, title: 'Native movie', overview: 'Radarr summary', backdropPath: '/background.jpg', runtime: 100 });
    expect(http.get).toHaveBeenCalledExactlyOnceWith('/movie', { params: { tmdbId: 299255 } });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('leaves an untracked movie to TMDB and rejects a mismatched tracked movie', async () => {
    const client = new RadarrClient('http://radarr', 'test');
    http.get.mockResolvedValueOnce({ data: [] });
    expect(await lookup(client)).toBeNull();
    http.get.mockResolvedValueOnce({ data: [{ id: 4, tmdbId: 99, title: 'Another movie' }] });
    await expect(lookup(client)).rejects.toThrow();
  });
});
