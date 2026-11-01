import type { ProviderSeasonCatalog } from './seriesCatalog.js';

/** Metadata supplied by a configured service; instance-local IDs never identify a title globally. */
export interface ProviderMediaMetadata {
  tmdbId: number;
  tvdbId: number | null;
  serviceMediaId: number | null;
  title: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  seasonCatalog?: ProviderSeasonCatalog;
}

export interface ServiceMetadata extends ProviderMediaMetadata {
  source: { serviceId: number; serviceName: string; provider: string; token: string };
  fetchedAt: string;
  stale: boolean;
}
