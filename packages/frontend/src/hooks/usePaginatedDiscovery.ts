import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import api from '@/lib/api';
import type { TmdbMedia } from '@/types';
import { buildDiscoverParams, type DiscoverFilters } from '@/utils/buildDiscoverParams';

const MAX_PAGES = 20;

export interface UsePaginatedDiscoveryOptions {
  /** Builds the full request URL for a given page (including any filter query params). */
  buildUrl: (page: number) => string;
  /** Current discover filters — a change triggers a re-fetch with transitioning state. */
  filters: DiscoverFilters;
  /** Sentinel element ref observed for infinite-scroll triggering. */
  sentinelRef: RefObject<HTMLElement | null>;
  /**
   * A stable string that identifies the current "route". When this changes the
   * hook does a hard reset (loading skeleton) instead of a soft transition.
   * For CategoryPage this is the slug; for DiscoverGenrePage it's `${mediaType}:${genreId}`.
   */
  routeKey: string;
  /** Optional transform applied to every result item (e.g. to set media_type). */
  mapResult?: (item: TmdbMedia) => TmdbMedia;
}

export interface UsePaginatedDiscoveryReturn {
  results: TmdbMedia[];
  loading: boolean;
  loadingMore: boolean;
  transitioning: boolean;
  page: number;
  totalPages: number;
  error: string | null;
}

export function usePaginatedDiscovery({
  buildUrl,
  filters,
  sentinelRef,
  routeKey,
  mapResult,
}: UsePaginatedDiscoveryOptions): UsePaginatedDiscoveryReturn {
  const [results, setResults] = useState<TmdbMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive a stable string key from only the API-relevant filter params so that
  // client-only toggles like hideRequested don't trigger a network refetch.
  const filterParams = buildDiscoverParams(filters);

  const seenIds = useRef(new Set<number>());
  // Separate controllers: loadMore must never abort the main (page-1) fetch — sharing one ref let
  // an observer-triggered loadMore kill an in-flight filter transition and strand `transitioning`.
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const prevRouteKeyRef = useRef(routeKey);

  // Keep refs in sync for use inside callbacks that close over stale state
  const buildUrlRef = useRef(buildUrl);
  buildUrlRef.current = buildUrl;
  const mapResultRef = useRef(mapResult);
  mapResultRef.current = mapResult;

  function dedup(items: TmdbMedia[]): TmdbMedia[] {
    return items.filter((item) => {
      if (seenIds.current.has(item.id)) return false;
      seenIds.current.add(item.id);
      return true;
    });
  }

  // Main fetch — runs on route change or filter change (useEffect deps dedup natively).
  useEffect(() => {
    const isRouteChange = prevRouteKeyRef.current !== routeKey;
    prevRouteKeyRef.current = routeKey;

    // Cancel any in-flight request (incl. a stale loadMore from the previous filter/route)
    abortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setTransitioning(false);
    if (isRouteChange) {
      setResults([]);
      setLoading(true);
    } else {
      setTransitioning(true);
    }
    setPage(1);
    setLoadingMore(false);
    setError(null);
    seenIds.current = new Set();

    api
      .get(buildUrl(1), { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return; // aborted-but-resolved would write stale dupes

        const transform = mapResultRef.current;
        const mapped = transform
          ? data.results.map((r: TmdbMedia) => transform(r))
          : data.results;
        const items = dedup(mapped);
        setResults(items);
        setTotalPages(Math.min(data.total_pages ?? 1, MAX_PAGES));
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error('Failed to fetch page:', err);
          setError(err?.message ?? 'Unknown error');
          // Disable infinite scroll until a successful fetch — with stale results still on screen,
          // a loadMore here would append the NEW filter's page 2 under the OLD filter's results.
          setTotalPages(0);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setTransitioning(false);
        }
      });

    return () => {
      controller.abort();
      loadMoreAbortRef.current?.abort(); // also cancel an in-flight loadMore on unmount
    };
  }, [routeKey, filterParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load next page
  const loadMore = useCallback(async () => {
    // loading/transitioning guard: a freshly re-attached observer fires immediately on a still-
    // intersecting sentinel during a filter change — with stale totalPages, this would append the
    // NEW filter's page 2 under the OLD filter's results.
    if (loading || transitioning || loadingMore || page >= totalPages) return;

    // Cancel any in-flight loadMore request and create a new controller
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const { data } = await api.get(buildUrlRef.current(nextPage), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const transform = mapResultRef.current;
      const mapped = transform
        ? data.results.map((r: TmdbMedia) => transform(r))
        : data.results;
      const items = dedup(mapped);
      setResults((prev) => [...prev, ...items]);
      setPage(nextPage);
    } catch (err: any) {
      if (!controller.signal.aborted) {
        console.error('Failed to load more:', err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoadingMore(false);
      }
    }
  }, [loading, transitioning, loadingMore, page, totalPages]);

  // Stable ref for loadMore so the observer effect doesn't re-subscribe every page
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: '400px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // deps re-attach when the sentinel (re)mounts (absent during initial loading, remounted when a
    // filter change resets page). `transitioning` re-fires the initial callback once the soft
    // transition resolves so infinite scroll resumes; during it, loadMore's guard ignores the fire.
  }, [sentinelRef, loading, transitioning, page, totalPages]);

  return { results, loading, loadingMore, transitioning, page, totalPages, error };
}
