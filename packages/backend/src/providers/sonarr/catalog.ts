import { z } from 'zod';
import type { ProviderSeasonCatalog } from '@oscarr/shared';
import { extractImageFromArr } from '../types.js';

const count = z.number().int().nonnegative();
export const catalogSeriesSchema = z.array(z.object({
  tvdbId: z.number().int().positive(),
  monitored: z.boolean().optional(),
  seasonType: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional(),
  seasons: z.array(z.object({
    seasonNumber: count,
    title: z.string().nullish(),
    monitored: z.boolean(),
    images: z.array(z.object({ coverType: z.string(), remoteUrl: z.string().optional(), url: z.string().optional() })).nullish(),
    statistics: z.object({ totalEpisodeCount: count.optional(), episodeFileCount: count.optional() }).nullish(),
  })),
}));

export function normalizeCatalog(raw: unknown, tvdbId: number, tracked: boolean): ProviderSeasonCatalog | null {
  const series = catalogSeriesSchema.parse(raw)[0];
  if (!series) return null;
  if (series.tvdbId !== tvdbId) throw new Error('Series catalog identity mismatch');
  if (new Set(series.seasons.map(s => s.seasonNumber)).size !== series.seasons.length) throw new Error('Duplicate season numbers');
  return {
    numbering: `tvdb:${series.seasonType || 'official'}`,
    tracked,
    seasons: series.seasons.filter(s => s.seasonNumber > 0).sort((a, b) => a.seasonNumber - b.seasonNumber).map(s => ({
      seasonNumber: s.seasonNumber,
      title: s.title || null,
      posterPath: extractImageFromArr((s.images ?? []).map(image => ({ ...image, remoteUrl: image.remoteUrl || image.url || '' })), 'poster'),
      episodeCount: tracked ? s.statistics?.totalEpisodeCount ?? null : null,
      episodeFileCount: tracked ? s.statistics?.episodeFileCount ?? null : null,
      monitored: tracked && series.monitored === true && s.monitored,
    })),
  };
}
