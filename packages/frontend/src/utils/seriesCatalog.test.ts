import { describe, expect, it } from 'vitest';
import { catalogSeasons, isSeasonComplete, seasonStatus } from './seriesCatalog';
import type { SeriesCatalog, SeriesSeason, TmdbSeason } from '@oscarr/shared';

const season: SeriesSeason = { seasonNumber: 18, title: 'Sun & Moon', posterPath: null, episodeCount: 146, episodeFileCount: 3, monitored: true };
const catalog: SeriesCatalog = { numbering: 'tvdb:official', tracked: true, seasons: [season],
  source: { provider: 'sonarr', serviceId: 2, serviceName: 'Sonarr', token: 'source' }, stale: false, fetchedAt: '2026-10-30T00:00:00Z' };
const tmdb = Array.from({ length: 25 }, (_, i): TmdbSeason => ({ id: i, season_number: i + 1, episode_count: 43, name: 'TMDB', overview: '', poster_path: '/tmdb.jpg', air_date: '2016-01-01' }));

describe('coherent season source', () => {
  it('does not advertise stale cached availability, while preserving live request and download states', () => {
    const complete = { ...season, episodeFileCount: 146 };
    expect(seasonStatus(complete, true, false, false, true)).toBe('unknown');
    expect(seasonStatus(season, true, false, false, true)).toBe('unknown');
    expect(seasonStatus(complete, true, true, false, true)).toBe('requested');
    expect(seasonStatus(complete, true, false, true, true)).toBe('downloading');
    expect(seasonStatus(complete, true, false, false, false)).toBe('complete');
  });

  it('uses only native seasons and counts, never appending or borrowing TMDB seasons', () => {
    expect(catalogSeasons(tmdb, catalog)).toEqual([season]);
  });
  it('keeps an independent TMDB fallback with unknown library state', () => {
    const result = catalogSeasons(tmdb, null);
    expect(result).toHaveLength(25);
    expect(result.every(s => s.episodeFileCount === null && !s.monitored)).toBe(true);
    expect(seasonStatus(result[0], null, false, false)).toBe('unknown');
  });
  it('does not let a smaller TMDB total turn a native partial season into complete', () => {
    expect(isSeasonComplete({ ...season, episodeFileCount: 43 })).toBe(false);
    expect(isSeasonComplete({ ...season, episodeFileCount: 146 })).toBe(true);
    expect(isSeasonComplete({ ...season, episodeCount: null })).toBe(false);
  });
  it('distinguishes monitored empty seasons, partial files and actual requests', () => {
    expect(seasonStatus({ ...season, episodeFileCount: 0 }, true, false, false)).toBe('monitored');
    expect(seasonStatus(season, true, true, false)).toBe('partial');
    expect(seasonStatus({ ...season, episodeFileCount: 0, monitored: false }, true, true, false)).toBe('requested');
    expect(seasonStatus({ ...season, episodeFileCount: null, monitored: false }, false, false, false)).toBe('not_requested');
  });
});
