import { beforeEach, expect, it, vi } from 'vitest';
import { getDownloads } from '../src/services/downloads.js';
const edge = vi.hoisted(() => ({ services: vi.fn(), client: vi.fn(), media: vi.fn() }));
vi.mock('../src/utils/services.js', () => ({ getAllServices: edge.services }));
vi.mock('../src/providers/index.js', () => ({ getArrClientForService: edge.client }));
vi.mock('../src/utils/prisma.js', () => ({ prisma: { media: { findMany: edge.media } } }));
beforeEach(() => {
  vi.resetAllMocks();
  edge.services.mockImplementation(async type => type === 'sonarr' ? [
    { id: 1, type, config: {} }, { id: 2, type, config: {} },
  ] : []);
  edge.media.mockResolvedValue([{ tvdbId: 76703, tmdbId: 60572 }]);
  edge.client.mockImplementation((id: number) => ({ getQueue: async () => ({ records: [{
    title: 'Pokémon', size: 100, sizeleft: 25, status: 'downloading', series: { tvdbId: 76703, seasonType: id === 2 ? 'alternate' : undefined },
    episode: { seasonNumber: 18, episodeNumber: 1, title: id === 2 ? 'Alternate' : 'Official' },
  }] }) }));
});
it('binds every queue to its instance and native numbering, even without a configured movie service', async () => {
  expect(await getDownloads()).toMatchObject([
    { tmdbId: 60572, serviceId: 1, seasonNumbering: 'tvdb:official', progress: 75 },
    { tmdbId: 60572, serviceId: 2, seasonNumbering: 'tvdb:alternate', progress: 75 },
  ]);
});
it('keeps the healthy instance queue when another instance is unavailable', async () => {
  edge.client.mockImplementation((id: number) => ({ getQueue: async () => {
    if (id === 1) throw new Error('offline');
    return { records: [{ series: { tvdbId: 76703 }, size: 10, sizeleft: 5 }] };
  } }));
  expect(await getDownloads()).toMatchObject([{ tmdbId: 60572, serviceId: 2 }]);
});
