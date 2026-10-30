import type { SeriesCatalog } from '@oscarr/shared';
import type { DownloadItem } from '@/hooks/useDownloads';

/** Episode integers are only comparable within the same configured service and numbering. */
export function catalogDownloads(downloads: DownloadItem[], tmdbId: number, catalog: SeriesCatalog | null): DownloadItem[] {
  if (!catalog?.tracked) return [];
  return downloads.filter(item => item.tmdbId === tmdbId && item.mediaType === 'tv'
    && item.serviceId === catalog.source.serviceId && item.seasonNumbering === catalog.numbering);
}
