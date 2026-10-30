import type { SeriesCatalog, SeriesSeason, TmdbSeason } from '@oscarr/shared';
import { fillOf } from './seasonFill';

export function catalogSeasons(metadata: TmdbSeason[] | undefined, catalog: SeriesCatalog | null): SeriesSeason[] {
  return catalog?.seasons ?? (metadata ?? []).filter(s => s.season_number > 0).map(s => ({
    seasonNumber: s.season_number, title: s.name, posterPath: s.poster_path,
    episodeCount: s.episode_count, episodeFileCount: null, monitored: false,
  }));
}

export function isSeasonComplete(season: SeriesSeason): boolean {
  return fillOf(season) === 'full';
}

export function seasonStatus(season: SeriesSeason, tracked: boolean | null, requested: boolean, downloading: boolean) {
  if (tracked === null) return requested ? 'requested' : 'unknown';
  if (isSeasonComplete(season)) return 'complete';
  if (downloading) return 'downloading';
  if (season.episodeFileCount) return 'partial';
  if (requested) return 'requested';
  if (season.monitored) return 'monitored';
  return tracked ? 'not_available' : 'not_requested';
}
