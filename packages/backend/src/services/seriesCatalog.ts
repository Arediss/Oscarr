import type { SeriesCatalog, SeriesEpisodes } from '@oscarr/shared';
import { getCached, setCache } from '../utils/cache.js';
import type { ArrClient } from '../providers/types.js';
import { getServiceMetadata, loadServiceMetadata, resolveMetadataSource, ServiceMetadataError } from './serviceMetadata.js';

const RETENTION_HOURS = 30 * 24;
export class SeriesCatalogError extends ServiceMetadataError {}

/** Validate on the actual routed target, without any display/offline cache, before writes. */
export async function validateSeasonSelection(client: Pick<ArrClient, 'getSeasonCatalog'>, externalId: number, seasons: number[], numbering: string): Promise<void> {
  const catalog = await client.getSeasonCatalog?.(externalId);
  if (!catalog || catalog.numbering !== numbering || seasons.some(number => !catalog.seasons.some(s => s.seasonNumber === number))) {
    throw new SeriesCatalogError('Season numbering changed or selection is unavailable; reload the season list', 409);
  }
}

/** Persistent metadata cache; never replaces a linked native catalog with TMDB numbering. */
export async function getSeriesCatalog(tmdbId: number, forceFresh = false, userId: number | null = null): Promise<SeriesCatalog | null> {
  const metadata = await getServiceMetadata(tmdbId, 'tv', { forceFresh, userId });
  return metadata?.seasonCatalog ? { ...metadata.seasonCatalog, source: metadata.source, fetchedAt: metadata.fetchedAt, stale: metadata.stale } : null;
}

export async function getSeriesEpisodes(tmdbId: number, seasonNumber: number, sourceToken: string, userId: number | null = null): Promise<SeriesEpisodes> {
  const source = await resolveMetadataSource(tmdbId, 'tv', userId);
  if (!source) throw new SeriesCatalogError('Series service unavailable');
  const key = `${source.cacheKey}:episodes:${sourceToken}:${seasonNumber}`;
  const cached = await getCached<SeriesEpisodes>(key);
  let metadata;
  try { metadata = await loadServiceMetadata(source, true); }
  catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
  const catalog = metadata?.seasonCatalog;
  if (!metadata || !catalog || metadata.source.token !== sourceToken) throw new SeriesCatalogError('Series source changed; reload the season list', 409);
  if (!catalog.seasons.some(s => s.seasonNumber === seasonNumber)) throw new SeriesCatalogError('Season not found', 404);
  if (!catalog.tracked) return { episodes: [], fetchedAt: metadata.fetchedAt, stale: false };
  try {
    if (!metadata.serviceMediaId || !source.client.getEpisodesNormalized) throw new SeriesCatalogError('Series episodes unavailable');
    const result = { episodes: await source.client.getEpisodesNormalized(metadata.serviceMediaId, seasonNumber), fetchedAt: new Date().toISOString(), stale: false };
    await setCache(key, result, RETENTION_HOURS);
    return result;
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}
