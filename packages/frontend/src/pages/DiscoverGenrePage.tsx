import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import MediaGrid from '@/components/MediaGrid';
import FilterBar, { DEFAULT_FILTERS, type FilterValues } from '@/components/FilterBar';
import { useMediaStatus } from '@/hooks/useMediaStatus';
import { usePaginatedDiscovery } from '@/hooks/usePaginatedDiscovery';
import { ALL_GENRES } from '@/components/GenreRow';
import { buildDiscoverParams } from '@/utils/buildDiscoverParams';
import type { TmdbMedia } from '@/types';

const SORT_OPTIONS_MOVIE = [
  { value: 'popularity.desc', labelKey: 'filter.sort_popularity' },
  { value: 'vote_average.desc', labelKey: 'filter.sort_rating' },
  { value: 'primary_release_date.desc', labelKey: 'filter.sort_newest' },
  { value: 'primary_release_date.asc', labelKey: 'filter.sort_oldest' },
];

const SORT_OPTIONS_TV = [
  { value: 'popularity.desc', labelKey: 'filter.sort_popularity' },
  { value: 'vote_average.desc', labelKey: 'filter.sort_rating' },
  { value: 'first_air_date.desc', labelKey: 'filter.sort_newest' },
  { value: 'first_air_date.asc', labelKey: 'filter.sort_oldest' },
];

export default function DiscoverGenrePage() {
  const { t } = useTranslation();
  const { mediaType, genreId } = useParams<{ mediaType: string; genreId: string }>();
  const [filters, setFilters] = useState<FilterValues>({ ...DEFAULT_FILTERS });
  const sentinelRef = useRef<HTMLDivElement>(null);

  const gid = Number.parseInt(genreId || '0');
  const genre = ALL_GENRES.find((g) => g.id === gid && g.mediaType === mediaType);
  const genreName = genre ? t(genre.nameKey) : t('genre.unknown');

  // Reset filters when the route changes
  useEffect(() => {
    setFilters({ ...DEFAULT_FILTERS });
  }, [mediaType, genreId]);

  const buildUrl = useCallback(
    (page: number) => {
      const fp = buildDiscoverParams(filters);
      return `/tmdb/discover/${mediaType}/genre/${genreId}?page=${page}${fp}`;
    },
    [mediaType, genreId, filters],
  );

  const mapResult = useCallback(
    (r: TmdbMedia): TmdbMedia => ({ ...r, media_type: mediaType }),
    [mediaType],
  );

  const { results, loading, loadingMore, transitioning, page, totalPages } =
    usePaginatedDiscovery({
      buildUrl,
      filters,
      sentinelRef,
      routeKey: `${mediaType}:${genreId}`,
      mapResult,
    });

  // Client-side "hide requested" filter (only one that needs status data)
  const statuses = useMediaStatus(results);
  const displayResults = useMemo(() => {
    if (!filters.hideRequested) return results;
    return results.filter((item) => {
      const type = item.media_type || (item.title ? 'movie' : 'tv');
      const key = `${type}:${item.id}`;
      if (!(key in statuses)) return false;
      return statuses[key].statusCategory === 'UNAVAILABLE';
    });
  }, [results, filters.hideRequested, statuses]);

  return (
    <div className="max-w-[1800px] mx-auto px-4 sm:px-8 pt-4 pb-16">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        sortOptions={mediaType === 'movie' ? SORT_OPTIONS_MOVIE : SORT_OPTIONS_TV}
        title={genreName}
        subtitle={mediaType === 'movie' ? t('discover.movies') : t('discover.series')}
        backButton={
          <Link to="/" className="p-2 glass rounded-xl hover:bg-white/10 transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5 text-white" />
          </Link>
        }
      />

      <div className={clsx('transition-opacity duration-300', transitioning && 'opacity-40 pointer-events-none')}>
        <MediaGrid media={displayResults} loading={loading} />
      </div>

      {!loading && page < totalPages && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {loadingMore && <Loader2 className="w-6 h-6 text-ndp-accent animate-spin" />}
        </div>
      )}

      {!loading && results.length === 0 && (
        <div className="text-center py-20">
          <p className="text-ndp-text-muted text-lg">{t('discover.no_results')}</p>
        </div>
      )}
    </div>
  );
}
