import { createHash } from 'node:crypto';
import type { ServiceMetadata } from '@oscarr/shared';
import { prisma } from '../utils/prisma.js';
import { getServiceById } from '../utils/services.js';
import { getArrClientForService, getServiceTypeForMedia } from '../providers/index.js';
import { getCached, setCache } from '../utils/cache.js';
import { resolveServiceContext } from './requestRouting.js';
import { rememberSeriesIdentity } from './mediaIdentity.js';

const FRESH_MS = 60_000;
const RETENTION_HOURS = 30 * 24;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class ServiceMetadataError extends Error {
  constructor(message: string, readonly statusCode = 502) { super(message); }
}

export async function resolveMetadataSource(tmdbId: number, mediaType: 'movie' | 'tv', userId: number | null = null) {
  const media = await prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
  const serviceId = media?.serviceId ?? (await resolveServiceContext(mediaType, tmdbId, userId)).targetService?.id;
  const service = serviceId ? await getServiceById(serviceId) : null;
  if (!service) {
    if (media?.serviceId) throw new ServiceMetadataError('Media service unavailable');
    return null;
  }
  if (service.type !== getServiceTypeForMedia(mediaType)) throw new ServiceMetadataError('Media service type changed');
  const client = getArrClientForService(service.id, service.type, service.config);
  if (!client.lookupMetadata) {
    if (media?.serviceId) throw new ServiceMetadataError('Service metadata unsupported');
    return null;
  }
  // Resolving a previously unknown TVDB ID must not invalidate the cache written by that lookup.
  const identity = hash(`${service.id}:${service.type}:${service.config.url?.replace(/\/+$/, '')}:${mediaType}:${tmdbId}`);
  return { service, client, tmdbId, mediaType, tvdbId: media?.tvdbId ?? null, linked: !!media?.serviceId,
    identity, cacheKey: `service-metadata:v1:${identity}` };
}
export type MetadataSource = NonNullable<Awaited<ReturnType<typeof resolveMetadataSource>>>;
const inFlight = new Map<string, Promise<ServiceMetadata | null>>();

export async function loadServiceMetadata(source: MetadataSource, forceFresh = false, refresh = false): Promise<ServiceMetadata | null> {
  const cached = await getCached<ServiceMetadata>(source.cacheKey);
  if (!forceFresh && !refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < FRESH_MS) return cached;
  let pending = inFlight.get(source.cacheKey);
  if (!pending) {
    pending = (async () => {
      const native = await source.client.lookupMetadata!({ tmdbId: source.tmdbId, tvdbId: source.tvdbId });
      if (!native) {
        if (source.linked) throw new ServiceMetadataError('Media not found on its service');
        return null;
      }
      if (native.tmdbId !== source.tmdbId) throw new ServiceMetadataError('Media identity mismatch');
      if (source.mediaType === 'tv') await rememberSeriesIdentity(source.tmdbId, native);
      const metadata: ServiceMetadata = { ...native,
        source: { serviceId: source.service.id, serviceName: source.service.name, provider: source.service.type,
          token: hash(`${source.identity}:${native.tvdbId}:${native.seasonCatalog?.numbering ?? 'tmdb'}`) },
        fetchedAt: new Date().toISOString(), stale: false,
      };
      await setCache(source.cacheKey, metadata, RETENTION_HOURS);
      return metadata;
    })();
    inFlight.set(source.cacheKey, pending);
    void pending.finally(() => { inFlight.delete(source.cacheKey); }).catch(() => { /* handled below */ });
  }
  try { return await pending; }
  catch {
    if (!forceFresh && cached) return { ...cached, stale: true };
    if (!forceFresh && !source.linked) return null;
    throw new ServiceMetadataError('Service metadata unavailable');
  }
}

export async function getServiceMetadata(tmdbId: number, mediaType: 'movie' | 'tv', options: { userId?: number | null; forceFresh?: boolean; refresh?: boolean } = {}): Promise<ServiceMetadata | null> {
  const source = await resolveMetadataSource(tmdbId, mediaType, options.userId);
  return source ? loadServiceMetadata(source, options.forceFresh, options.refresh) : null;
}
