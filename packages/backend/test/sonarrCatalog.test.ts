import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SonarrClient } from '../src/providers/sonarr/client.js';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http } }));
vi.mock('../src/utils/fetchWithRetry.js', () => ({ attachAxiosRetry: (client: unknown) => client }));

const tvdbId = 76703;
interface Catalog {
  numbering: string; tracked: boolean;
  seasons: Array<{ seasonNumber: number; title: string | null; posterPath: string | null;
    episodeCount: number | null; monitored: boolean; episodeFileCount: number | null }>;
}
// This explicit boundary lets the regression run red before the optional provider method exists.
async function catalog() {
  return (new SonarrClient('http://sonarr.test', 'test') as unknown as {
    getSeasonCatalog(id: number): Promise<Catalog | null>;
  }).getSeasonCatalog(tvdbId);
}
function trackedSeries() {
  return {
    id: 42, tvdbId, title: 'Pokémon', monitored: true,
    seasons: [
      { seasonNumber: 0, monitored: true, statistics: { totalEpisodeCount: 3, episodeFileCount: 3 } },
      ...Array.from({ length: 20 }, (_, index) => ({
        seasonNumber: index + 1, title: `TVDB season ${index + 1}`, monitored: index !== 1,
        images: [{ coverType: 'poster', remoteUrl: `https://artworks.thetvdb.com/pokemon-${index + 1}.jpg`, url: '/MediaCover/local.jpg' }],
        statistics: { totalEpisodeCount: 52, episodeCount: 40, episodeFileCount: index === 0 ? 52 : 0 },
      })),
    ],
  };
}

beforeEach(() => vi.resetAllMocks());

describe('Sonarr native season catalog', () => {
  it('shows the twenty official Pokémon seasons rather than manufacturing twenty-five TMDB matches', async () => {
    http.get.mockResolvedValue({ data: [trackedSeries()] });
    const result = await catalog();
    expect(http.get).toHaveBeenCalledExactlyOnceWith('/series', { params: { tvdbId, includeSeasonImages: true } });
    expect(result).toMatchObject({ numbering: 'tvdb:official', tracked: true });
    expect(result?.seasons.map(season => season.seasonNumber)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(result?.seasons[0]).toEqual({
      seasonNumber: 1, title: 'TVDB season 1', posterPath: 'https://artworks.thetvdb.com/pokemon-1.jpg',
      episodeCount: 52, monitored: true, episodeFileCount: 52,
    });
    expect(result?.seasons[1]).toMatchObject({ monitored: false, episodeFileCount: 0, episodeCount: 52 });
    expect(http.put).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('does not call an unmonitored series monitored merely because its season is monitored', async () => {
    http.get.mockResolvedValue({ data: [{ ...trackedSeries(), monitored: false }] });
    expect((await catalog())?.seasons.every(season => season.monitored === false)).toBe(true);
  });

  it('preserves native alternate numbering instead of presenting it as official', async () => {
    http.get.mockResolvedValue({ data: [{ ...trackedSeries(), seasonType: 'alternate' }] });
    expect((await catalog())?.numbering).toBe('tvdb:alternate');
  });

  it('looks up an untracked series and keeps unknown counts distinct from zero files', async () => {
    http.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{
      tvdbId, title: 'Pokémon', monitored: true,
      seasons: [{ seasonNumber: 0, monitored: true }, { seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: false }],
    }] });
    expect(await catalog()).toEqual({ numbering: 'tvdb:official', tracked: false, seasons: [
      { seasonNumber: 1, title: null, posterPath: null, monitored: false, episodeCount: null, episodeFileCount: null },
      { seasonNumber: 2, title: null, posterPath: null, monitored: false, episodeCount: null, episodeFileCount: null },
    ] });
    expect(http.get).toHaveBeenNthCalledWith(2, '/series/lookup', { params: { term: `tvdb:${tvdbId}` } });
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('returns no catalog when the requested TVDB series cannot be found', async () => {
    http.get.mockResolvedValue({ data: [] });
    expect(await catalog()).toBeNull();
  });

  it.each([
    { data: { seasons: [] } },
    { data: [{ ...trackedSeries(), seasons: null }] },
    { data: [{ ...trackedSeries(), seasons: [{ seasonNumber: '1', monitored: true }] }] },
    { data: [{ ...trackedSeries(), seasons: [{ seasonNumber: 1, monitored: true, statistics: { totalEpisodeCount: -1, episodeFileCount: 0 } }] }] },
  ])('rejects malformed upstream catalog rather than displaying false season information (%j)', async response => {
    http.get.mockResolvedValue(response);
    await expect(catalog()).rejects.toThrow();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('rejects a tracked series with a different TVDB ID before any fallback lookup', async () => {
    http.get.mockResolvedValue({ data: [{ ...trackedSeries(), tvdbId: tvdbId + 1 }] });
    await expect(catalog()).rejects.toThrow();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('rejects an unrelated lookup result rather than borrowing its seasons', async () => {
    http.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ ...trackedSeries(), tvdbId: tvdbId + 1 }] });
    await expect(catalog()).rejects.toThrow();
    expect(http.get).toHaveBeenCalledTimes(2);
  });
});
