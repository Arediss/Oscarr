import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { patchAppSettings } from '../src/utils/appSettings.js';
import { sendToService } from '../src/services/requestService.js';

const transport = vi.hoisted(() => ({
  getRootFolders: vi.fn(async () => [{ path: '/media' }]),
  getTags: vi.fn(async () => [{ id: 7, label: 'vostfr' }, { id: 9, label: 'anime' }]),
  getOrCreateTag: vi.fn(async () => 7),
  getQualityProfiles: vi.fn(async () => [{ id: 1 }]),
  findByExternalId: vi.fn<() => Promise<{ id: number } | null>>(async () => null),
  addMedia: vi.fn(async () => undefined),
  addTagsToMedia: vi.fn(async () => undefined),
  requestSeasons: vi.fn(async () => undefined),
  searchMedia: vi.fn(async () => undefined),
  defaultRootFolder: '/media',
}));
vi.mock('../src/providers/index.js', async original => ({
  ...await original<typeof import('../src/providers/index.js')>(),
  getArrClientForService: vi.fn(() => transport),
  getArrClient: vi.fn(async () => transport),
  createServiceTagClient: vi.fn(() => transport),
}));
vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));
vi.mock('../src/services/tmdb.js', async original => ({
  ...await original<typeof import('../src/services/tmdb.js')>(),
  getMovieDetails: vi.fn(async () => ({ id: 101, genres: [{ name: 'Animation' }] })),
  getTvDetails: vi.fn(async () => ({ id: 101, genres: [{ name: 'Animation' }] })),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  transport.findByExternalId.mockResolvedValue(null);
  transport.getTags.mockResolvedValue([{ id: 7, label: 'vostfr' }, { id: 9, label: 'anime' }]);
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.folderRule.deleteMany();
  await prisma.service.deleteMany();
  await patchAppSettings({ arrUserTaggingEnabled: false, defaultQualityProfile: 1 });
});

async function setup(mediaType: 'tv' | 'movie') {
  const service = await prisma.service.create({ data: { name: 'Target', type: mediaType === 'tv' ? 'sonarr' : 'radarr', config: '{}' } });
  await prisma.folderRule.create({ data: {
    name: 'Animation', mediaType, conditions: '[{"field":"genre","operator":"contains","value":"Animation"}]',
    folderPath: '/media', serviceId: service.id, tagIds: '[7,9]', seriesType: mediaType === 'tv' ? 'anime' : null,
  } });
  return prisma.media.create({ data: { tmdbId: 101, tvdbId: mediaType === 'tv' ? 201 : null, title: 'Animation', mediaType } });
}

describe('request dispatch with routing tags', () => {
  it.each(['tv', 'movie'] as const)('sends rule tags on new %s requests even when user tagging is off', async mediaType => {
    const media = await setup(mediaType);
    expect(await sendToService(media, mediaType, 'Requester')).toBe(true);
    expect(transport.addMedia).toHaveBeenCalledWith(expect.objectContaining({ tags: [7, 9], rootFolderPath: '/media' }));
    expect(transport.getOrCreateTag).not.toHaveBeenCalled();
  });

  it('deduplicates rule and requester tags', async () => {
    const media = await setup('tv');
    await patchAppSettings({ arrUserTaggingEnabled: true });
    expect(await sendToService(media, 'tv', 'Requester')).toBe(true);
    expect(transport.addMedia).toHaveBeenCalledWith(expect.objectContaining({ tags: [7, 9] }));
  });

  it.each(['tv', 'movie'] as const)('adds rule tags to an existing %s before searching', async mediaType => {
    const media = await setup(mediaType);
    transport.findByExternalId.mockResolvedValue({ id: 42 });
    expect(await sendToService(media, mediaType, 'Requester', null, mediaType === 'tv' ? [2] : undefined)).toBe(true);
    expect(transport.addTagsToMedia).toHaveBeenCalledWith(42, [7, 9]);
    expect(transport.addMedia).not.toHaveBeenCalled();
    expect(mediaType === 'tv' ? transport.requestSeasons : transport.searchMedia).toHaveBeenCalled();
  });

  it('does not send the request with missing tags after an upstream deletion', async () => {
    const media = await setup('tv');
    transport.getTags.mockResolvedValue([]);
    expect(await sendToService(media, 'tv', 'Requester')).toBe(false);
    expect(transport.addMedia).not.toHaveBeenCalled();
  });
});
