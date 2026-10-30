/** A season number is meaningful only within its provider's numbering scheme. */
export interface SeriesSeason {
  seasonNumber: number;
  title: string | null;
  posterPath: string | null;
  episodeCount: number | null;
  episodeFileCount: number | null;
  monitored: boolean;
}

export interface ProviderSeasonCatalog {
  numbering: string;
  tracked: boolean;
  seasons: SeriesSeason[];
}

export interface SeriesCatalog extends ProviderSeasonCatalog {
  source: { serviceId: number; serviceName: string; provider: string; token: string };
  fetchedAt: string;
  stale: boolean;
}

export interface SeriesEpisode {
  episodeNumber: number;
  title: string;
  airDateUtc: string | null;
  hasFile: boolean | null;
  monitored: boolean;
  quality: string | null;
  size: number | null;
}

export interface SeriesEpisodes {
  episodes: SeriesEpisode[];
  fetchedAt: string;
  stale: boolean;
}
