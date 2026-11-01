/** TMDB response types — single source of truth consumed by backend (services/tmdb.ts)
 *  and frontend (types/index.ts). Keeping both sides synchronized was a recurring drift source.
 *
 *  TmdbMovie / TmdbTv are the strict shapes (required fields for their kind).
 *  TmdbMedia is a loose union shape for generic rows (rows, carousels, search results) where
 *  the consumer doesn't know movie vs tv until media_type is inspected. */

export interface TmdbSeason {
  id: number;
  season_number: number;
  episode_count: number;
  name: string;
  overview: string;
  poster_path: string | null;
  air_date: string;
}

export interface TmdbEpisode {
  episode_number: number;
  name: string;
  air_date: string | null;
}

export interface TmdbSeasonDetails {
  episodes: TmdbEpisode[];
}

export interface TmdbCast {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface TmdbCrew {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

export interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  name: string;
}

export interface TmdbCollectionRef {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface TmdbCollection extends TmdbCollectionRef {
  overview: string;
  parts: TmdbMovie[];
}

export interface TmdbMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  media_type?: string;
  runtime?: number;
  status?: string;
  tagline?: string;
  belongs_to_collection?: TmdbCollectionRef | null;
  credits?: { cast: TmdbCast[]; crew: TmdbCrew[] };
  external_ids?: { imdb_id: string; tvdb_id: number };
  videos?: { results: TmdbVideo[] };
  keywords?: { keywords: { id: number; name: string }[] };
  release_dates?: { results: { iso_3166_1: string; release_dates: { certification: string; type: number }[] }[] };
}

export interface TmdbTv {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  media_type?: string;
  number_of_seasons: number;
  number_of_episodes: number;
  status?: string;
  origin_country?: string[];
  original_language?: string;
  seasons?: TmdbSeason[];
  credits?: { cast: TmdbCast[]; crew: TmdbCrew[] };
  external_ids?: { imdb_id: string; tvdb_id: number };
  videos?: { results: TmdbVideo[] };
  keywords?: { results: { id: number; name: string }[] };
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
}

/** Loose shape for contexts that don't know movie-vs-tv upfront (grids, carousels, rows).
 *  Every field that's required on one side is optional here; narrow to TmdbMovie/TmdbTv when
 *  a consumer needs the strict shape. */
export interface TmdbMedia {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count: number;
  media_type?: string;
  lastEpisodeInfo?: { season: number; episode: number; title: string } | null;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  runtime?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  tagline?: string;
  belongs_to_collection?: TmdbCollectionRef | null;
  seasons?: TmdbSeason[];
  credits?: { cast: TmdbCast[]; crew: TmdbCrew[] };
  external_ids?: { imdb_id: string; tvdb_id: number };
  videos?: { results: TmdbVideo[] };
}

export type TmdbMediaResult = (TmdbMovie | TmdbTv) & { media_type: string };

export interface TmdbPerson {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  known_for_department: string;
  combined_credits: {
    cast: (TmdbMedia & { character: string })[];
    crew: (TmdbMedia & { job: string; department: string })[];
  };
}
