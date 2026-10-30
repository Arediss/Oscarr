import { useCallback, useEffect, useRef, useState } from 'react';
import type { SeriesCatalog, ServiceMetadata, TmdbMedia } from '@oscarr/shared';
import api from '@/lib/api';
import { detailWithServiceMetadata } from '@/utils/serviceMetadata';

/** Resolve the hero once, so a late service response cannot swap its artwork/title mid-animation. */
export function useMediaMetadata(id: string | undefined, type: 'movie' | 'tv') {
  const key = `${type}:${id}`;
  const [snapshot, setSnapshot] = useState<{
    key: string; media: TmdbMedia | null; catalog: SeriesCatalog | null; metadata: ServiceMetadata | null; error: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const refreshKey = useRef<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => { refreshKey.current = key; setRevision(value => value + 1); }, [key]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const forceRefresh = refreshKey.current === key;
    refreshKey.current = null;
    setRefreshing(true);
    Promise.allSettled([
      api.get<TmdbMedia>(`/tmdb/${type}/${id}`, { signal: controller.signal }),
      api.get<ServiceMetadata | null>(`/media/${type}/${id}/metadata`, { signal: controller.signal, params: { refresh: forceRefresh } }),
    ]).then(([tmdbResult, serviceResult]) => {
      if (controller.signal.aborted) return;
      const tmdb = tmdbResult.status === 'fulfilled' ? tmdbResult.value.data : null;
      const metadata = serviceResult.status === 'fulfilled' ? serviceResult.value.data : null;
      const catalog = metadata?.seasonCatalog ? { ...metadata.seasonCatalog, source: metadata.source,
        fetchedAt: metadata.fetchedAt, stale: metadata.stale } : null;
      setSnapshot({ key, media: detailWithServiceMetadata(tmdb, metadata, type), catalog, metadata,
        error: serviceResult.status === 'rejected' });
      setRefreshing(false);
    });
    return () => controller.abort();
  }, [id, type, key, revision]);
  const current = snapshot?.key === key ? snapshot : null;
  return { media: current?.media ?? null, catalog: current?.catalog ?? null, metadata: current?.metadata ?? null,
    loading: !current, seasonsLoading: !current, seasonsError: current?.error ?? false, refreshing, refresh };
}
