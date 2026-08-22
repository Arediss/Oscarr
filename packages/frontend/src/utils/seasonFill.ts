export interface TmdbSeasonLike {
  season_number: number;
  episode_count: number;
}

export interface SonarrSeasonLike {
  seasonNumber: number;
  episodeFileCount: number;
  totalEpisodeCount: number;
}

/** How complete a season is, from Sonarr's own file counts. `unknown` means Sonarr does not track
 *  this series yet — the season is requestable and shows TMDB's episode count instead. */
export type Fill = 'full' | 'partial' | 'empty' | 'unknown';

export function fillOf(season: TmdbSeasonLike, sonarr: SonarrSeasonLike | undefined): Fill {
  if (!sonarr) return 'unknown';
  const total = sonarr.totalEpisodeCount || season.episode_count;
  if (total > 0 && sonarr.episodeFileCount >= total) return 'full';
  return sonarr.episodeFileCount > 0 ? 'partial' : 'empty';
}

/**
 * A season the user can still ask for: anything the library does not hold in full.
 *
 * One rule, two consumers — the action button and the season picker. Deriving it twice is how they
 * drifted apart, with the button reading "Available" while two seasons were plainly missing.
 * Sonarr reports percentOfEpisodes against *monitored* episodes, so a series with one complete
 * season and two unmonitored ones comes back 100% complete; only the per-season counts tell the
 * truth.
 */
export function hasRequestableSeasons(seasons: TmdbSeasonLike[], sonarrSeasons: SonarrSeasonLike[]): boolean {
  return seasons
    .filter((s) => s.season_number > 0)
    .some((s) => fillOf(s, sonarrSeasons.find((ss) => ss.seasonNumber === s.season_number)) !== 'full');
}
