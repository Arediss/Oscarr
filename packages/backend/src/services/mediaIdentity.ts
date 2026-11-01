import type { ProviderMediaMetadata } from '@oscarr/shared';
import type { ArrClient } from '../providers/types.js';
import { prisma } from '../utils/prisma.js';

/** A shared guard for detail lookups and dispatch; never persist an approximate title match. */
export async function rememberSeriesIdentity(tmdbId: number, metadata: ProviderMediaMetadata): Promise<number> {
  if (metadata.tmdbId !== tmdbId || !Number.isSafeInteger(metadata.tvdbId) || metadata.tvdbId! <= 0) {
    throw new Error(`Invalid service identity for TMDB ${tmdbId}`);
  }
  await prisma.media.updateMany({ where: { tmdbId, mediaType: 'tv', tvdbId: null }, data: { tvdbId: metadata.tvdbId } });
  const existing = await prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId, mediaType: 'tv' } }, select: { tvdbId: true } });
  if (existing?.tvdbId && existing.tvdbId !== metadata.tvdbId) throw new Error(`Conflicting service identity for TMDB ${tmdbId}`);
  return metadata.tvdbId!;
}

export async function resolveSeriesIdentity(client: ArrClient, media: { tmdbId: number; tvdbId: number | null }): Promise<number> {
  if (media.tvdbId && Number.isSafeInteger(media.tvdbId) && media.tvdbId > 0) return media.tvdbId;
  const metadata = await client.lookupMetadata?.({ tmdbId: media.tmdbId });
  if (!metadata) throw new Error(`No service identity found for TMDB ${media.tmdbId}`);
  return rememberSeriesIdentity(media.tmdbId, metadata);
}
