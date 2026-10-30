import { beforeEach, expect, it, vi } from 'vitest';
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
const { runFullSync } = await import('../src/services/sync/index.js');
let mediaId: number;
let requestId: number;
let source: ArrMediaItem;

beforeEach(async () => {
  vi.resetAllMocks();
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.user.deleteMany();
  await prisma.service.deleteMany();
  const service = await prisma.service.create({ data: { name: 'Sonarr anime', type: 'sonarr', config: '{}' } });
  const user = await prisma.user.create({ data: { email: 'metadata-sync@test.local' } });
  const media = await prisma.media.create({ data: {
    tmdbId: 60572, tvdbId: 76703, sonarrId: 409, serviceId: service.id,
    mediaType: 'tv', title: 'Pokémon', statusCategory: 'PROCESSING',
    seasons: { create: Array.from({ length: 25 }, (_, i) => ({ seasonNumber: i + 1, episodeCount: 52 })) },
  } });
  mediaId = media.id;
  requestId = (await prisma.mediaRequest.create({ data: {
    mediaId, userId: user.id, mediaType: 'tv', status: 'approved', seasons: '[21,22]', seasonNumbering: null,
  } })).id;
  source = {
    externalId: 76703, tmdbId: 60572, serviceMediaId: 409, title: 'Pokémon', statusCategory: 'PROCESSING',
    posterPath: null, backdropPath: null, qualityProfileId: 1, addedDate: null, tags: [], hasFile: false,
    seasons: Array.from({ length: 20 }, (_, i) => ({ seasonNumber: i + 1, totalEpisodeCount: i === 17 ? 146 : 52,
      monitored: true, episodeFileCount: 0, percentComplete: 0, statusCategory: 'SEARCHING' })),
  };
  edge.library.mockResolvedValue([source]);
});

it('replaces 25 old seasons with the 20 native seasons and preserves user/config/request identities on repeated syncs', async () => {
  const request = await prisma.mediaRequest.findUnique({ where: { id: requestId } });
  const services = await prisma.service.findMany();
  const users = await prisma.user.findMany();
  for (let i = 0; i < 2; i++) {
    await runFullSync();
    const seasons = await prisma.season.findMany({ where: { mediaId }, orderBy: { seasonNumber: 'asc' } });
    expect(seasons.map(season => season.seasonNumber)).toEqual(Array.from({ length: 20 }, (_, j) => j + 1));
    expect(seasons[17].episodeCount).toBe(146);
    expect(await prisma.mediaRequest.findUnique({ where: { id: requestId } })).toEqual(request);
    expect(await prisma.service.findMany()).toEqual(services);
    expect(await prisma.user.findMany()).toEqual(users);
  }
});

it('keeps old seasons when the source cannot be read', async () => {
  edge.library.mockRejectedValue(new Error('offline'));
  await expect(runFullSync()).rejects.toThrow('sonarr=1');
  expect(await prisma.season.count({ where: { mediaId } })).toBe(25);
});

it('rolls back season replacement if native data cannot be written', async () => {
  source.seasons!.push(source.seasons![0]);
  await expect(runFullSync()).rejects.toThrow('sonarr=1');
  expect(await prisma.season.count({ where: { mediaId } })).toBe(25);
});

it('removes old seasons when a successful source explicitly returns an empty catalog', async () => {
  source.seasons = [];
  await runFullSync();
  expect(await prisma.season.count({ where: { mediaId } })).toBe(0);
  expect(await prisma.mediaRequest.count()).toBe(1);
});
