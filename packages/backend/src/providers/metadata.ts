import { z } from 'zod';
import type { ProviderMediaMetadata } from '@oscarr/shared';
import { extractImageFromArr } from './types.js';

/** Parse only public metadata. Paths, credentials and other instance configuration stay out. */
const metadataSchema = z.array(z.object({
  id: z.number().int().nonnegative().optional(),
  tmdbId: z.number().int().nonnegative().nullish(),
  tvdbId: z.number().int().positive().optional(),
  title: z.string().trim().min(1),
  overview: z.string().nullish(),
  images: z.array(z.object({ coverType: z.string(), remoteUrl: z.string().optional(), url: z.string().optional() })).nullish(),
  firstAired: z.string().nullish(),
  inCinemas: z.string().nullish(),
  runtime: z.number().nonnegative().nullish(),
}).passthrough()).max(1);

export function parseMetadata(raw: unknown, identity: { tmdbId: number; tvdbId?: number | null }, mediaType: 'tv' | 'movie') {
  const item = metadataSchema.parse(raw)[0];
  if (!item) return null;
  // Older Sonarr versions may omit tmdbId when an already verified TVDB identity was used.
  const knownTvdb = mediaType === 'tv' && identity.tvdbId != null;
  if ((knownTvdb && item.tvdbId !== identity.tvdbId)
    || (item.tmdbId && item.tmdbId !== identity.tmdbId)
    || (!knownTvdb && item.tmdbId !== identity.tmdbId)
    || (mediaType === 'tv' && !item.tvdbId)) {
    throw new Error('Service metadata identity mismatch');
  }
  return item;
}

export function metadataFields(item: NonNullable<ReturnType<typeof parseMetadata>>, tmdbId: number, mediaType: 'tv' | 'movie'): ProviderMediaMetadata {
  const images = (item.images ?? []).map(image => ({ ...image, remoteUrl: image.remoteUrl || image.url || '' }));
  return {
    tmdbId, tvdbId: item.tvdbId ?? null, serviceMediaId: item.id || null,
    title: item.title, overview: item.overview || null,
    posterPath: extractImageFromArr(images, 'poster'), backdropPath: extractImageFromArr(images, 'fanart'),
    releaseDate: (mediaType === 'tv' ? item.firstAired : item.inCinemas) || null,
    runtime: item.runtime || null,
  };
}
