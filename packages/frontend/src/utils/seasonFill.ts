import type { SeriesSeason } from '@oscarr/shared';

export type Fill = 'full' | 'partial' | 'empty' | 'unknown';

/** Counts belong to a single provider. Missing totals cannot borrow TMDB's numbering. */
export function fillOf(season: SeriesSeason): Fill {
  if (season.episodeFileCount === null) return 'unknown';
  if (season.episodeCount !== null && season.episodeCount > 0 && season.episodeFileCount >= season.episodeCount) return 'full';
  return season.episodeFileCount > 0 ? 'partial' : 'empty';
}

export function hasRequestableSeasons(seasons: SeriesSeason[]): boolean {
  return seasons.filter(s => s.seasonNumber > 0).some(s => fillOf(s) !== 'full');
}
