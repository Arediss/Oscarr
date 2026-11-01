import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import type { ArrMediaItem } from '../src/providers/types.js';
import { syncArrService } from '../src/services/sync/mediaSync.js';
import { loadFreeQualityMediaIds } from '../src/services/availability.js';

const edge = vi.hoisted(() => ({ library: vi.fn(), notify: vi.fn() }));
vi.mock('../src/providers/index.js', () => ({
  getArrClientForService: (serviceId: number, serviceType: string) => ({
    mediaType: serviceType === 'radarr' ? 'movie' : 'tv', serviceType,
    getAllMedia: () => edge.library(serviceId),
  }),
  arrIdFieldForClient: (client: { serviceType: string }) => client.serviceType === 'radarr' ? 'radarrId' : 'sonarrId',
  getServiceDefinition: () => ({ category: 'arr' }),
}));
vi.mock('../src/services/sync/helpers.js', () => ({
  sendAvailabilityNotifications: edge.notify,
  findAvailabilityRecipients: async () => [],
}));
vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));

const since = new Date('2026-10-30T00:00:00Z');
const addedDate = '2025-01-01T00:00:00Z';
const oldUpdatedAt = new Date('2025-01-02T00:00:00Z');

beforeEach(async () => {
  vi.resetAllMocks();
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.folderRule.deleteMany();
  await prisma.qualityOption.deleteMany();
  await prisma.service.deleteMany();
});

async function setup(mediaType: 'movie' | 'tv', nativeProfile = 1) {
  const serviceType = mediaType === 'movie' ? 'radarr' : 'sonarr';
  const service = await prisma.service.create({ data: { name: 'Owning instance', type: serviceType, config: '{}' } });
  const option = await prisma.qualityOption.create({ data: { label: 'HD' } });
  await prisma.qualityMapping.create({ data: {
    serviceId: service.id, qualityOptionId: option.id, qualityProfileId: 1, qualityProfileName: 'Any',
  } });
  const media = await prisma.media.create({ data: {
    tmdbId: 101, mediaType, title: 'Already available', statusCategory: 'AVAILABLE',
    tvdbId: mediaType === 'tv' ? 303 : null,
    radarrId: mediaType === 'movie' ? 42 : null, sonarrId: mediaType === 'tv' ? 42 : null,
    serviceId: service.id, qualityProfileId: 3, availableAt: new Date(addedDate), updatedAt: oldUpdatedAt,
    ...(mediaType === 'tv' ? { seasons: { create: [{ seasonNumber: 1, episodeCount: 8, statusCategory: 'AVAILABLE' }] } } : {}),
  } });
  const native: ArrMediaItem = {
    tmdbId: 101, externalId: mediaType === 'tv' ? 303 : 101, serviceMediaId: 42,
    title: media.title, statusCategory: 'AVAILABLE', qualityProfileId: nativeProfile,
    addedDate, hasFile: true, posterPath: null, backdropPath: null, tags: [],
    ...(mediaType === 'tv' ? { seasons: [{ seasonNumber: 1, totalEpisodeCount: 8, episodeFileCount: 8,
      monitored: true, percentComplete: 100, statusCategory: 'AVAILABLE' as const }] } : {}),
  };
  edge.library.mockResolvedValue([native]);
  return { serviceType, service, option, media, native };
}

describe.each(['movie', 'tv'] as const)('incremental %s quality profile refresh', mediaType => {
  it('refreshes an already available old title when its owning service changes profile and clears the satisfied quality offer', async () => {
    const { serviceType, service, media } = await setup(mediaType);
    expect(await loadFreeQualityMediaIds([media.id])).toEqual(new Set([media.id]));
    expect(await syncArrService(serviceType, since)).toMatchObject({ added: 0, updated: 1, errors: 0 });
    expect(await prisma.media.findUnique({ where: { id: media.id } })).toMatchObject({
      id: media.id, statusCategory: 'AVAILABLE', serviceId: service.id, qualityProfileId: 1,
      availableAt: media.availableAt,
    });
    expect(await loadFreeQualityMediaIds([media.id])).toEqual(new Set());
    expect(edge.notify).not.toHaveBeenCalled();
  });

  it('leaves an unchanged available item and its season rows untouched without repeating availability notifications', async () => {
    const { serviceType, media } = await setup(mediaType, 3);
    const seasons = await prisma.season.findMany({ where: { mediaId: media.id } });
    expect(await syncArrService(serviceType, since)).toMatchObject({ added: 0, updated: 0, errors: 0 });
    expect(await prisma.media.findUnique({ where: { id: media.id } })).toEqual(media);
    expect(await prisma.season.findMany({ where: { mediaId: media.id } })).toEqual(seasons);
    expect(edge.notify).not.toHaveBeenCalled();
  });

  it('does not borrow another instance profile even when its external and internal media IDs are identical', async () => {
    const { serviceType, service, option, media } = await setup(mediaType);
    await prisma.service.update({ where: { id: service.id }, data: { enabled: false } });
    const other = await prisma.service.create({ data: { name: 'Other instance', type: serviceType, config: '{}' } });
    await prisma.qualityMapping.create({ data: {
      serviceId: other.id, qualityOptionId: option.id, qualityProfileId: 1, qualityProfileName: 'Any',
    } });
    expect(await syncArrService(serviceType, since)).toMatchObject({ added: 0, updated: 0, errors: 0 });
    expect(await prisma.media.findUnique({ where: { id: media.id } })).toEqual(media);
    expect(await loadFreeQualityMediaIds([media.id])).toEqual(new Set([media.id]));
    expect(edge.notify).not.toHaveBeenCalled();
  });

  it('persists a genuinely different unmapped profile while continuing to offer the unsatisfied quality', async () => {
    const { serviceType, service, media } = await setup(mediaType, 5);
    expect(await syncArrService(serviceType, since)).toMatchObject({ added: 0, updated: 1, errors: 0 });
    expect(await prisma.media.findUnique({ where: { id: media.id } })).toMatchObject({
      id: media.id, serviceId: service.id, qualityProfileId: 5, statusCategory: 'AVAILABLE',
    });
    expect(await loadFreeQualityMediaIds([media.id])).toEqual(new Set([media.id]));
    expect(edge.notify).not.toHaveBeenCalled();
  });
});
