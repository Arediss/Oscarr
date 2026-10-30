import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import type { ArrMediaItem } from '../src/providers/types.js';

const edge = vi.hoisted(() => ({ library: vi.fn() }));
vi.mock('../src/providers/index.js', () => ({
  getArrClientForService: () => ({ mediaType: 'tv', serviceType: 'sonarr', getAllMedia: edge.library }),
  arrIdFieldForClient: () => 'sonarrId',
}));
vi.mock('../src/services/sync/availabilitySync.js', () => ({
  syncAvailabilityDates: async () => ({ radarrUpdated: 0, sonarrUpdated: 0 }),
}));
vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));
const { runFullSync, syncArrService } = await import('../src/services/sync/index.js');

let serviceId: number;
let userId: number;
const nativeSeries = (title: string, tmdbId: number, externalId: number, serviceMediaId: number): ArrMediaItem => ({
  title, tmdbId, externalId, serviceMediaId, statusCategory: 'SEARCHING', posterPath: null, backdropPath: null,
  qualityProfileId: 1, addedDate: null, tags: [], hasFile: false,
  seasons: [{ seasonNumber: 1, totalEpisodeCount: 8, monitored: true,
    episodeFileCount: 0, percentComplete: 0, statusCategory: 'SEARCHING' }],
});
async function requestFor(mediaId: number, mediaType = 'tv') {
  return prisma.mediaRequest.create({ data: { mediaId, userId, mediaType, status: 'pending' } });
}

beforeEach(async () => {
  vi.resetAllMocks();
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.user.deleteMany();
  await prisma.service.deleteMany();
  serviceId = (await prisma.service.create({ data: { name: 'Sonarr', type: 'sonarr', config: '{}' } })).id;
  userId = (await prisma.user.create({ data: { email: 'sync-identity@test.local', displayName: 'Requester' } })).id;
});

describe('native series identity during library sync', () => {
  it('refuses an ambiguous native TMDB fallback without overwriting the existing media or request', async () => {
    const original = await prisma.media.create({ data: { tmdbId: 124834, mediaType: 'tv', title: 'Unlinked series' } });
    const request = await requestFor(original.id);
    edge.library.mockResolvedValue([
      nativeSeries('First native identity', 124834, 395494, 1638),
      nativeSeries('Second native identity', 124834, 999999, 9999),
    ]);
    expect(await syncArrService('sonarr')).toMatchObject({ added: 0, updated: 0, errors: 2 });
    expect(await prisma.media.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.mediaRequest.findUnique({ where: { id: request.id } })).toEqual(request);
    expect(await prisma.season.count()).toBe(0);
  });

  it('fills missing TVDB identity on the existing Heartstopper TMDB row instead of creating a duplicate', async () => {
    const original = await prisma.media.create({ data: {
      tmdbId: 124834, mediaType: 'tv', title: 'Heartstopper', tvdbId: null, sonarrId: null, serviceId: null,
    } });
    const request = await requestFor(original.id);
    const users = await prisma.user.findMany();
    edge.library.mockResolvedValue([nativeSeries('Heartstopper', 124834, 395494, 1638)]);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await runFullSync()).sonarr.errors).toBe(0);
      expect(await prisma.media.findUnique({ where: { id: original.id } })).toMatchObject({
        id: original.id, tmdbId: 124834, tvdbId: 395494, sonarrId: 1638, serviceId,
      });
      expect(await prisma.media.count()).toBe(1);
      expect(await prisma.mediaRequest.findUnique({ where: { id: request.id } })).toEqual(request);
      expect(await prisma.user.findMany()).toEqual(users);
    }
  });

  it('accepts a Sonarr TVDB remap only for the same instance-local series and keeps its existing requests', async () => {
    const original = await prisma.media.create({ data: {
      tmdbId: 296286, mediaType: 'tv', title: 'Smoking Behind the Supermarket',
      tvdbId: 465973, sonarrId: 1591, serviceId,
    } });
    const request = await requestFor(original.id);
    edge.library.mockResolvedValue([nativeSeries('Smoking Behind the Supermarket', 296286, 483430, 1591)]);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await runFullSync()).sonarr.errors).toBe(0);
      expect(await prisma.media.findUnique({ where: { id: original.id } })).toMatchObject({
        id: original.id, tmdbId: 296286, tvdbId: 483430, sonarrId: 1591, serviceId,
      });
      expect(await prisma.media.count()).toBe(1);
      expect(await prisma.mediaRequest.findUnique({ where: { id: request.id } })).toEqual(request);
      expect(await prisma.season.findMany({ where: { mediaId: original.id } }))
        .toMatchObject([{ seasonNumber: 1, episodeCount: 8 }]);
    }
  });

  it.each(['different instance', 'different internal ID'] as const)(
    'does not overwrite an existing positive TVDB mapping when the claimed remap has a %s', async conflict => {
      const otherInstance = conflict === 'different instance'
        ? await prisma.service.create({ data: { name: 'Other Sonarr', type: 'sonarr', config: '{}', enabled: false } })
        : null;
      const original = await prisma.media.create({ data: {
        tmdbId: 296286, mediaType: 'tv', title: 'Original mapped show', tvdbId: 465973,
        serviceId: otherInstance?.id ?? serviceId, sonarrId: conflict === 'different internal ID' ? 99 : 1591,
      } });
      const request = await requestFor(original.id);
      edge.library.mockResolvedValue([nativeSeries('Claimed remap', 296286, 483430, 1591)]);
      const result = await syncArrService('sonarr');
      expect(result).toMatchObject({ added: 0, updated: 0, errors: 1 });
      expect(await prisma.media.findUnique({ where: { id: original.id } })).toEqual(original);
      expect(await prisma.media.count()).toBe(1);
      expect(await prisma.mediaRequest.findUnique({ where: { id: request.id } })).toEqual(request);
    },
  );

  it('rejects a TVDB match when the existing positive TMDB identity belongs to another title', async () => {
    const original = await prisma.media.create({ data: {
      tmdbId: 111111, mediaType: 'tv', title: 'Another canonical title',
      tvdbId: 395494, sonarrId: 1638, serviceId,
    } });
    const request = await requestFor(original.id);
    edge.library.mockResolvedValue([nativeSeries('Heartstopper', 124834, 395494, 1638)]);
    expect(await syncArrService('sonarr')).toMatchObject({ added: 0, updated: 0, errors: 1 });
    expect(await prisma.media.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await prisma.media.count()).toBe(1);
    expect(await prisma.mediaRequest.findUnique({ where: { id: request.id } })).toEqual(request);
  });

  it('does not merge a native placeholder into a canonical row whose different TVDB mapping has an incompatible owner', async () => {
    const otherInstance = await prisma.service.create({ data: {
      name: 'Other Sonarr', type: 'sonarr', config: '{}', enabled: false,
    } });
    const canonical = await prisma.media.create({ data: {
      tmdbId: 296286, mediaType: 'tv', title: 'Canonical show from another instance',
      tvdbId: 465973, sonarrId: 99, serviceId: otherInstance.id,
    } });
    const placeholder = await prisma.media.create({ data: {
      tmdbId: -483430, mediaType: 'tv', title: 'Native placeholder',
      tvdbId: 483430, sonarrId: 1591, serviceId,
    } });
    const canonicalRequest = await requestFor(canonical.id);
    const placeholderRequest = await requestFor(placeholder.id);
    edge.library.mockResolvedValue([nativeSeries('Smoking Behind the Supermarket', 296286, 483430, 1591)]);
    expect(await syncArrService('sonarr')).toMatchObject({ added: 0, updated: 0, errors: 1 });
    expect(await prisma.media.findMany({ orderBy: { id: 'asc' } })).toEqual([canonical, placeholder]);
    expect(await prisma.mediaRequest.findMany({ orderBy: { id: 'asc' } }))
      .toEqual([canonicalRequest, placeholderRequest]);
  });

  it('keeps the movie namespace separate when a new series has the same positive TMDB ID', async () => {
    const movie = await prisma.media.create({ data: {
      tmdbId: 124834, mediaType: 'movie', title: 'Unrelated film', radarrId: 45, statusCategory: 'AVAILABLE',
    } });
    const request = await requestFor(movie.id, 'movie');
    edge.library.mockResolvedValue([nativeSeries('Heartstopper', 124834, 395494, 1638)]);
    expect((await runFullSync()).sonarr).toMatchObject({ added: 1, errors: 0 });
    expect(await prisma.media.findUnique({ where: { id: movie.id } })).toEqual(movie);
    expect(await prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId: 124834, mediaType: 'tv' } } }))
      .toMatchObject({ tmdbId: 124834, tvdbId: 395494, sonarrId: 1638, serviceId });
    expect(await prisma.media.count()).toBe(2);
    expect(await prisma.mediaRequest.findUnique({ where: { id: request.id } })).toEqual(request);
  });
});
