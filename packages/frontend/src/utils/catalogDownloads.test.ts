import { describe, expect, it } from 'vitest';
import type { SeriesCatalog } from '@oscarr/shared';
import type { DownloadItem } from '@/hooks/useDownloads';
import { catalogDownloads } from './catalogDownloads';

const catalog: SeriesCatalog = { source: { serviceId: 2, serviceName: 'Anime', provider: 'sonarr', token: 'a' },
  numbering: 'tvdb:official', tracked: true, seasons: [], fetchedAt: '', stale: false };
const item: DownloadItem = { tmdbId: 60572, mediaType: 'tv', serviceId: 2, seasonNumbering: 'tvdb:official',
  title: 'Download', status: 'downloading', progress: 30, timeLeft: '', estimatedCompletion: '', size: 100, sizeLeft: 70,
  episode: { seasonNumber: 18, episodeNumber: 1, title: 'Alola' } };
describe('download catalog provenance', () => {
  it('shows only downloads from the same instance and numbering', () => {
    expect(catalogDownloads([item, { ...item, serviceId: 1 }, { ...item, seasonNumbering: 'tvdb:alternate' }], 60572, catalog)).toEqual([item]);
  });
  it('never paints a native download on TMDB or an untracked catalog', () => {
    expect(catalogDownloads([item], 60572, null)).toEqual([]);
    expect(catalogDownloads([item], 60572, { ...catalog, tracked: false })).toEqual([]);
  });
  it('does not interpret a legacy queue without source identity', () => {
    expect(catalogDownloads([{ ...item, serviceId: undefined }], 60572, catalog)).toEqual([]);
  });
});
