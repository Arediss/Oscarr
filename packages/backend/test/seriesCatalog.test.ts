import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const edge = vi.hoisted(() => ({
  media: vi.fn(), service: vi.fn(), services: vi.fn(), client: vi.fn(), tmdb: vi.fn(),
  catalog: vi.fn(), find: vi.fn(), episodes: vi.fn(),
  cache: new Map<string, { value: unknown; expires: number }>(),
}));
vi.mock('../src/utils/prisma.js', () => ({ prisma: { media: { findUnique: edge.media, updateMany: vi.fn() } } }));
vi.mock('../src/utils/services.js', () => ({ getServiceById: edge.service, getAllServices: edge.services }));
vi.mock('../src/providers/index.js', () => ({ getArrClientForService: edge.client, getServiceTypeForMedia: () => 'sonarr' }));
vi.mock('../src/services/requestRouting.js', () => ({ resolveServiceContext: async () => ({ targetService: (await edge.services('sonarr'))[0] ?? null }) }));
vi.mock('../src/services/tmdb.js', () => ({ getTvDetails: edge.tmdb }));
vi.mock('../src/utils/cache.js', () => ({
  getCached: async (key: string) => {
    const entry = edge.cache.get(key);
    return entry && entry.expires > Date.now() ? structuredClone(entry.value) : null;
  },
  setCache: async (key: string, value: unknown, ttlHours = 24) => {
    edge.cache.set(key, { value: structuredClone(value), expires: Date.now() + ttlHours * 3600000 });
  },
}));

const service = { id: 7, name: 'Sonarr anime', type: 'sonarr', enabled: true, isDefault: true, config: { url: 'http://one', apiKey: 'test' } };
const media = { id: 1, tmdbId: 25, mediaType: 'tv', tvdbId: 76703, serviceId: 7, sonarrId: 999 };
const native = { numbering: 'tvdb:official', tracked: true, seasons: Array.from({ length: 20 }, (_, i) => ({
  seasonNumber: i + 1, title: `Native ${i + 1}`, posterPath: null, episodeCount: 52,
  episodeFileCount: i === 0 ? 52 : 0, monitored: true,
})) };
const episode = { episodeNumber: 1, title: 'TVDB first episode', airDateUtc: null, hasFile: true, monitored: true, quality: 'HDTV', size: 123 };
const load = () => import('../src/services/seriesCatalog.js');

beforeEach(() => {
  vi.resetAllMocks();
  edge.cache.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
  edge.media.mockResolvedValue(media);
  edge.service.mockResolvedValue(service);
  edge.services.mockResolvedValue([service]);
  edge.catalog.mockResolvedValue(native);
  edge.find.mockResolvedValue({ id: 42 });
  edge.episodes.mockResolvedValue([episode]);
  edge.client.mockReturnValue({ lookupMetadata: async (identity: { tmdbId: number; tvdbId: number | null }) => ({
    tmdbId: identity.tmdbId, tvdbId: identity.tvdbId ?? 76703, serviceMediaId: 42, title: 'Native Pokémon',
    overview: null, posterPath: null, backdropPath: null, releaseDate: null, runtime: null,
    seasonCatalog: await edge.catalog(identity.tvdbId ?? 76703),
  }), findByExternalId: edge.find, getEpisodesNormalized: edge.episodes });
});
afterEach(() => vi.useRealTimers());

describe('instance-bound native series catalog', () => {
  it('returns native seasons and reuses the fresh persistent catalog for sixty seconds', async () => {
    const { getSeriesCatalog } = await load();
    const first = await getSeriesCatalog(25);
    expect(edge.media).toHaveBeenCalledWith({ where: { tmdbId_mediaType: { tmdbId: 25, mediaType: 'tv' } } });
    expect(edge.service).toHaveBeenCalledWith(7);
    expect(edge.catalog).toHaveBeenCalledWith(76703);
    expect(first).toMatchObject({ ...native, stale: false, source: { serviceId: 7, serviceName: 'Sonarr anime', provider: 'sonarr' } });
    expect(first?.source.token).toEqual(expect.any(String));
    expect(first?.seasons).toHaveLength(20);
    vi.advanceTimersByTime(59000);
    expect(await getSeriesCatalog(25)).toEqual(first);
    expect(edge.catalog).toHaveBeenCalledTimes(1);
    expect(edge.tmdb).not.toHaveBeenCalled();
  });

  it('serves a marked stale catalog after an outage but refuses it for forced validation', async () => {
    const { getSeriesCatalog } = await load();
    const first = await getSeriesCatalog(25);
    vi.advanceTimersByTime(61000);
    edge.catalog.mockRejectedValue(new Error('offline'));
    expect(await getSeriesCatalog(25)).toMatchObject({ seasons: first!.seasons, source: first!.source, fetchedAt: first!.fetchedAt, stale: true });
    await expect(getSeriesCatalog(25, true)).rejects.toThrow();
    vi.advanceTimersByTime(31 * 24 * 3600000);
    await expect(getSeriesCatalog(25)).rejects.toThrow();
  });

  it('does not reuse another server cache after the URL changes behind the same service ID', async () => {
    const { getSeriesCatalog } = await load();
    const first = await getSeriesCatalog(25);
    edge.service.mockResolvedValue({ ...service, config: { ...service.config, url: 'http://two' } });
    edge.catalog.mockResolvedValue({ ...native, seasons: native.seasons.slice(0, 3) });
    const second = await getSeriesCatalog(25);
    expect(second?.seasons).toHaveLength(3);
    expect(second?.source.token).not.toBe(first?.source.token);
    expect(edge.catalog).toHaveBeenCalledTimes(2);
    edge.service.mockResolvedValue({ ...service, config: { ...service.config, url: 'http://three' } });
    edge.catalog.mockRejectedValue(new Error('replacement offline'));
    await expect(getSeriesCatalog(25)).rejects.toThrow();
  });

  it('never falls back from an unavailable linked instance to the default instance', async () => {
    const { getSeriesCatalog } = await load();
    edge.service.mockResolvedValue(null);
    await expect(getSeriesCatalog(25)).rejects.toThrow();
    expect(edge.services).not.toHaveBeenCalled();
    expect(edge.catalog).not.toHaveBeenCalled();
  });

  it('returns null without a service, and resolves a missing TVDB ID through the routed service', async () => {
    const { getSeriesCatalog } = await load();
    edge.media.mockResolvedValue({ ...media, serviceId: null, tvdbId: null });
    edge.services.mockResolvedValue([]);
    expect(await getSeriesCatalog(25)).toBeNull();
    edge.services.mockResolvedValue([service]);
    edge.tmdb.mockResolvedValue({ id: 25, external_ids: { tvdb_id: 76703 }, seasons: Array.from({ length: 25 }, (_, i) => ({ season_number: i + 1 })) });
    expect((await getSeriesCatalog(25))?.seasons).toHaveLength(20);
    expect(edge.services).toHaveBeenCalledWith('sonarr');
    expect(edge.catalog).toHaveBeenCalledWith(76703);
    expect(edge.tmdb).not.toHaveBeenCalled();
  });

  it('rejects a stale source token before loading episodes even when a fresh catalog was cached', async () => {
    const { getSeriesCatalog, getSeriesEpisodes } = await load();
    await getSeriesCatalog(25);
    await expect(getSeriesEpisodes(25, 1, 'obsolete-source')).rejects.toThrow();
    expect(edge.catalog).toHaveBeenCalledTimes(2);
    expect(edge.episodes).not.toHaveBeenCalled();
  });

  it('uses the verified current instance metadata ID and returns only its native episodes', async () => {
    const { getSeriesCatalog, getSeriesEpisodes } = await load();
    const catalog = await getSeriesCatalog(25);
    const result = await getSeriesEpisodes(25, 1, catalog!.source.token);
    expect(edge.find).not.toHaveBeenCalled();
    expect(edge.episodes).toHaveBeenCalledWith(42, 1);
    expect(result).toMatchObject({ episodes: [episode], stale: false });
    expect(edge.tmdb).not.toHaveBeenCalled();
  });
});
