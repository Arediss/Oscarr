import { describe, expect, it } from 'vitest';
import type { ServiceMetadata, TmdbMedia } from '@oscarr/shared';
import { detailWithServiceMetadata } from './serviceMetadata';

const tmdb: TmdbMedia = { id: 60572, name: 'TMDB Pokémon', overview: 'TMDB description', poster_path: '/tmdb.jpg',
  backdrop_path: '/backdrop.jpg', vote_average: 8, vote_count: 123, number_of_seasons: 25,
  seasons: [{ id: 21, season_number: 21, name: 'Season 21', episode_count: 100, overview: '', poster_path: null, air_date: '' }],
  credits: { cast: [], crew: [] }, videos: { results: [] } };
const native: ServiceMetadata = { tmdbId: 60572, tvdbId: 76703, serviceMediaId: 409, title: 'Native Pokémon',
  overview: 'Sonarr description', posterPath: 'https://artworks.thetvdb.com/native.jpg', backdropPath: null,
  runtime: 25, releaseDate: '1997-04-01T00:00:00Z', source: { serviceId: 2, serviceName: 'Anime', provider: 'sonarr', token: 'test' },
  fetchedAt: '2026-10-30T00:00:00Z', stale: false,
  seasonCatalog: { numbering: 'tvdb:official', tracked: true, seasons: Array.from({ length: 20 }, (_, i) => ({
    seasonNumber: i + 1, title: null, posterPath: null, episodeCount: 52, episodeFileCount: 0, monitored: true,
  })) } };

describe('detail metadata source precedence', () => {
  it('uses native metadata and twenty seasons, keeping TMDB supplementary credits and ratings', () => {
    const detail = detailWithServiceMetadata(tmdb, native, 'tv');
    expect(detail).toMatchObject({ id: 60572, name: 'Native Pokémon', overview: 'Sonarr description',
      poster_path: native.posterPath, backdrop_path: '/backdrop.jpg', first_air_date: '1997-04-01',
      number_of_seasons: 20, vote_average: 8, vote_count: 123, credits: tmdb.credits });
    expect(detail?.seasons).toBeUndefined();
  });
  it('can render a service-owned title when TMDB is unavailable', () => {
    expect(detailWithServiceMetadata(null, native, 'tv')).toMatchObject({ id: 60572, name: 'Native Pokémon', number_of_seasons: 20 });
  });
  it('keeps TMDB browsing when no native metadata exists', () => {
    expect(detailWithServiceMetadata(tmdb, null, 'tv')).toBe(tmdb);
    expect(detailWithServiceMetadata(null, null, 'tv')).toBeNull();
  });
  it('does not attach the previous navigation metadata to another title', () => {
    expect(detailWithServiceMetadata({ ...tmdb, id: 99 }, native, 'tv')).toMatchObject({ id: 99, name: 'TMDB Pokémon' });
  });
  it('uses a Radarr movie title without adding a series name or changing TMDB identity', () => {
    expect(detailWithServiceMetadata(null, { ...native, tvdbId: null, seasonCatalog: undefined }, 'movie'))
      .toMatchObject({ id: 60572, title: 'Native Pokémon', runtime: 25, release_date: '1997-04-01' });
  });
});
