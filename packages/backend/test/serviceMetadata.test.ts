import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderMediaMetadata } from '@oscarr/shared';
import { prisma } from '../src/utils/prisma.js';

const edge = vi.hoisted(() => ({ lookup: vi.fn(), routing: vi.fn(), client: vi.fn() }));
vi.mock('../src/providers/index.js', async original => ({
  ...await original<typeof import('../src/providers/index.js')>(),
  getArrClientForService: edge.client,
}));
vi.mock('../src/services/requestRouting.js', () => ({ resolveServiceContext: edge.routing }));
vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));

const tmdbId = 60572;
const tvdbId = 76703;
const nativeSeries = (): ProviderMediaMetadata => ({
  tmdbId, tvdbId, serviceMediaId: 409, title: 'Pokémon', overview: 'Native Sonarr overview',
  posterPath: 'https://artworks.thetvdb.com/poster.jpg', backdropPath: null, releaseDate: '1997-04-01', runtime: 25,
  seasonCatalog: { numbering: 'tvdb:official', tracked: true, seasons: Array.from({ length: 20 }, (_, i) => ({
    seasonNumber: i + 1, title: `Native season ${i + 1}`, posterPath: null,
    episodeCount: 52, episodeFileCount: i === 0 ? 52 : 0, monitored: true,
  })) },
});
const nativeMovie = (): ProviderMediaMetadata => ({
  tmdbId, tvdbId: null, serviceMediaId: 121, title: 'A movie from Radarr', overview: 'Native Radarr overview',
  posterPath: '/radarr-poster.jpg', backdropPath: '/radarr-backdrop.jpg', releaseDate: '2026-01-01', runtime: 111,
});
const load = () => import('../src/services/serviceMetadata.js');
let serviceId: number;

async function createService(type: 'sonarr' | 'radarr', url: string, name: string = type) {
  return prisma.service.create({ data: { type, name, config: JSON.stringify({ url, apiKey: 'metadata-test-key' }) } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.folderRule.deleteMany();
  await prisma.qualityOption.deleteMany();
  await prisma.service.deleteMany();
  await prisma.tmdbCache.deleteMany();
  serviceId = (await createService('sonarr', 'http://sonarr-one.test', 'Sonarr anime')).id;
  await prisma.media.create({ data: { tmdbId, tvdbId, mediaType: 'tv', title: 'Pokémon', serviceId, sonarrId: 409 } });
  edge.routing.mockResolvedValue({ targetService: { id: serviceId } });
  edge.lookup.mockImplementation(async (type: string) => type === 'sonarr' ? nativeSeries() : nativeMovie());
  edge.client.mockImplementation((_id: number, type: string) => ({
    lookupMetadata: (identity: { tmdbId: number; tvdbId?: number }) => edge.lookup(type, identity),
  }));
  // Date alone is virtual: Prisma still needs the real event loop for its database engine.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('service metadata snapshots', () => {
  it('returns native metadata for the linked instance and persists a fresh snapshot reused for sixty seconds', async () => {
    const { getServiceMetadata } = await load();
    const first = await getServiceMetadata(tmdbId, 'tv', { userId: 23 });
    expect(first).toMatchObject({ ...nativeSeries(), stale: false,
      source: { serviceId, serviceName: 'Sonarr anime', provider: 'sonarr' } });
    expect(first?.source.token).toMatch(/^[a-f0-9]{64}$/);
    expect(first?.fetchedAt).toBe('2026-10-30T12:00:00.000Z');
    expect(edge.routing).not.toHaveBeenCalled();
    const snapshots = await prisma.tmdbCache.findMany();
    expect(snapshots).toHaveLength(1);
    expect(new Date(snapshots[0].expiresAt).getTime() - Date.now()).toBe(30 * 24 * 3600_000);
    vi.setSystemTime(new Date('2026-10-30T12:00:59Z'));
    expect(await getServiceMetadata(tmdbId, 'tv')).toEqual(first);
    expect(edge.lookup).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-30T12:01:01Z'));
    const updated = await getServiceMetadata(tmdbId, 'tv');
    expect(updated?.fetchedAt).toBe('2026-10-30T12:01:01.000Z');
    expect(updated?.source.token).toBe(first?.source.token);
    expect(edge.lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps the same cache identity after persisting a newly resolved TVDB mapping', async () => {
    const { getServiceMetadata } = await load();
    await prisma.media.updateMany({ data: { tvdbId: null } });
    const first = await getServiceMetadata(tmdbId, 'tv');
    expect(await prisma.media.findFirst()).toMatchObject({ tmdbId, tvdbId, serviceId });
    const second = await getServiceMetadata(tmdbId, 'tv');
    expect(second).toEqual(first);
    expect(edge.lookup).toHaveBeenCalledTimes(1);
    expect(await prisma.tmdbCache.count()).toBe(1);
  });

  it('returns marked last-known metadata during an outage but refuses stale data for a forced refresh', async () => {
    const { getServiceMetadata } = await load();
    const first = await getServiceMetadata(tmdbId, 'tv');
    vi.setSystemTime(new Date('2026-10-30T12:01:01Z'));
    edge.lookup.mockRejectedValue(new Error('Service offline'));
    expect(await getServiceMetadata(tmdbId, 'tv')).toMatchObject({
      ...nativeSeries(), source: first!.source, fetchedAt: first!.fetchedAt, stale: true,
    });
    await expect(getServiceMetadata(tmdbId, 'tv', { forceFresh: true })).rejects.toThrow();
    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'));
    await expect(getServiceMetadata(tmdbId, 'tv')).rejects.toThrow();
  });

  it('never borrows an old snapshot after replacing the URL behind the same service ID', async () => {
    const { getServiceMetadata } = await load();
    const original = await getServiceMetadata(tmdbId, 'tv');
    await prisma.service.update({ where: { id: serviceId },
      data: { config: JSON.stringify({ url: 'http://sonarr-two.test', apiKey: 'metadata-test-key' }) } });
    edge.lookup.mockResolvedValue({ ...nativeSeries(), serviceMediaId: 2, title: 'From replacement Sonarr' });
    const replacement = await getServiceMetadata(tmdbId, 'tv');
    expect(replacement).toMatchObject({ serviceMediaId: 2, title: 'From replacement Sonarr' });
    expect(replacement?.source.token).not.toBe(original?.source.token);
    await prisma.service.update({ where: { id: serviceId },
      data: { config: JSON.stringify({ url: 'http://sonarr-three.test', apiKey: 'metadata-test-key' }) } });
    edge.lookup.mockRejectedValue(new Error('Replacement offline'));
    await expect(getServiceMetadata(tmdbId, 'tv')).rejects.toThrow();
  });

  it('refreshes a displayed snapshot immediately but preserves the native source if that refresh fails', async () => {
    const { getServiceMetadata } = await load();
    const first = await getServiceMetadata(tmdbId, 'tv');
    edge.lookup.mockRejectedValue(new Error('Service offline'));
    const refreshed = await getServiceMetadata(tmdbId, 'tv', { refresh: true });
    expect(edge.lookup).toHaveBeenCalledTimes(2);
    expect(refreshed).toMatchObject({ ...nativeSeries(), source: first!.source, stale: true });
  });

  it('never substitutes the default instance when the linked instance is disabled', async () => {
    const { getServiceMetadata } = await load();
    const fallback = await createService('sonarr', 'http://default.test');
    edge.routing.mockResolvedValue({ targetService: { id: fallback.id } });
    await getServiceMetadata(tmdbId, 'tv');
    await prisma.service.update({ where: { id: serviceId }, data: { enabled: false } });
    edge.lookup.mockClear();
    await expect(getServiceMetadata(tmdbId, 'tv')).rejects.toThrow();
    expect(edge.routing).not.toHaveBeenCalled();
    expect(edge.lookup).not.toHaveBeenCalled();
  });

  it('uses the request routing context for an unlinked title and isolates successive target instances', async () => {
    const { getServiceMetadata } = await load();
    await prisma.media.updateMany({ data: { serviceId: null } });
    const secondService = await createService('sonarr', 'http://second-target.test', 'Other Sonarr');
    edge.routing.mockImplementation(async (_type, _id, userId) => ({
      targetService: { id: userId === 12 ? serviceId : secondService.id },
    }));
    const first = await getServiceMetadata(tmdbId, 'tv', { userId: 12 });
    const second = await getServiceMetadata(tmdbId, 'tv', { userId: 34 });
    expect(first?.source.serviceId).toBe(serviceId);
    expect(second?.source.serviceId).toBe(secondService.id);
    expect(first?.source.token).not.toBe(second?.source.token);
    expect(edge.lookup).toHaveBeenCalledTimes(2);
    expect(await prisma.media.findFirst()).toMatchObject({ serviceId: null });
  });

  it('returns null without a configured target and does not perform an upstream lookup', async () => {
    const { getServiceMetadata } = await load();
    await prisma.media.updateMany({ data: { serviceId: null } });
    edge.routing.mockResolvedValue({ targetService: null });
    expect(await getServiceMetadata(tmdbId, 'tv')).toBeNull();
    expect(edge.lookup).not.toHaveBeenCalled();
  });

  it('keeps unavailable native data distinct from an unlinked discovery fallback', async () => {
    const { getServiceMetadata } = await load();
    edge.lookup.mockRejectedValue(new Error('Offline'));
    await expect(getServiceMetadata(tmdbId, 'tv')).rejects.toThrow();
    await prisma.media.updateMany({ data: { serviceId: null } });
    expect(await getServiceMetadata(tmdbId, 'tv')).toBeNull();
    edge.lookup.mockResolvedValue(null);
    expect(await getServiceMetadata(tmdbId, 'tv')).toBeNull();
  });

  it('loads Radarr metadata for a film without sharing a TV identity or its cached catalog', async () => {
    const { getServiceMetadata } = await load();
    const series = await getServiceMetadata(tmdbId, 'tv');
    const radarr = await createService('radarr', 'http://radarr.test', 'Radarr films');
    await prisma.media.create({ data: { tmdbId, mediaType: 'movie', title: 'Film', serviceId: radarr.id, radarrId: 121 } });
    const movie = await getServiceMetadata(tmdbId, 'movie');
    expect(movie).toMatchObject({ ...nativeMovie(), stale: false,
      source: { serviceId: radarr.id, serviceName: 'Radarr films', provider: 'radarr' } });
    expect(movie?.seasonCatalog).toBeUndefined();
    expect(movie?.source.token).not.toBe(series?.source.token);
    expect(await prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId, mediaType: 'movie' } } }))
      .toMatchObject({ tvdbId: null, serviceId: radarr.id });
    expect(await prisma.tmdbCache.count()).toBe(2);
  });

  it('coalesces concurrent lookups for one source without retaining an in-flight request after completion', async () => {
    const { getServiceMetadata } = await load();
    let release!: (metadata: ProviderMediaMetadata) => void;
    edge.lookup.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = [getServiceMetadata(tmdbId, 'tv'), getServiceMetadata(tmdbId, 'tv')];
    try {
      await vi.waitFor(() => expect(edge.lookup).toHaveBeenCalledTimes(1));
    } finally {
      release(nativeSeries());
    }
    const [first, second] = await Promise.all(pending);
    expect(first).toEqual(second);
    vi.setSystemTime(new Date('2026-10-30T12:01:01Z'));
    await getServiceMetadata(tmdbId, 'tv');
    expect(edge.lookup).toHaveBeenCalledTimes(2);
  });
});
