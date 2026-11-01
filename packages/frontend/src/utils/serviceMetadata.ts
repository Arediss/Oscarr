import type { ServiceMetadata, TmdbMedia } from '@oscarr/shared';

/** Service fields take precedence; TMDB still supplies credits, discovery links and trailers. */
export function detailWithServiceMetadata(tmdb: TmdbMedia | null, native: ServiceMetadata | null, type: 'tv' | 'movie'): TmdbMedia | null {
  if (!native || (tmdb && native.tmdbId !== tmdb.id)) return tmdb;
  const detail: TmdbMedia = {
    ...(tmdb ?? { id: native.tmdbId, overview: '', poster_path: null, backdrop_path: null, vote_average: 0, vote_count: 0 }),
    media_type: type,
    ...(type === 'tv' ? { name: native.title } : { title: native.title }),
    overview: native.overview ?? tmdb?.overview ?? '',
    poster_path: native.posterPath ?? tmdb?.poster_path ?? null,
    backdrop_path: native.backdropPath ?? tmdb?.backdrop_path ?? null,
    runtime: native.runtime ?? tmdb?.runtime,
  };
  if (native.releaseDate) {
    if (type === 'tv') detail.first_air_date = native.releaseDate.slice(0, 10);
    else detail.release_date = native.releaseDate.slice(0, 10);
  }
  if (native.tvdbId) detail.external_ids = { imdb_id: tmdb?.external_ids?.imdb_id ?? '', tvdb_id: native.tvdbId };
  if (native.seasonCatalog) {
    detail.seasons = undefined;
    detail.number_of_seasons = native.seasonCatalog.seasons.length;
    detail.number_of_episodes = native.seasonCatalog.seasons.every(s => s.episodeCount !== null)
      ? native.seasonCatalog.seasons.reduce((sum, s) => sum + s.episodeCount!, 0) : undefined;
  }
  return detail;
}
