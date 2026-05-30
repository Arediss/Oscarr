import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import MediaGrid from '@/components/MediaGrid';
import FilterBar, { DEFAULT_FILTERS, type FilterValues } from '@/components/FilterBar';
import { useMediaStatus } from '@/hooks/useMediaStatus';
import { usePaginatedDiscovery } from '@/hooks/usePaginatedDiscovery';
import { buildDiscoverParams } from '@/utils/buildDiscoverParams';
import type { TmdbMedia } from '@/types';

const CURRENT_YEAR = new Date().getFullYear();

interface CategoryDef {
  titleKey: string;
  mediaType: 'movie' | 'tv' | 'all';
  genreId: number;
  defaultFilters?: Partial<FilterValues>;
  originCountry?: string;
  keyword?: number;
  /** Use this endpoint when no filters are active (same data as homepage) */
  defaultEndpoint?: string;
}

const CATEGORIES: Record<string, CategoryDef> = {
  trending: {
    titleKey: 'category.trending',
    mediaType: 'all',
    genreId: 0,
    defaultEndpoint: '/tmdb/trending',
  },
  'movies-popular': {
    titleKey: 'category.popular_movies',
    mediaType: 'movie',
    genreId: 0,
  },
  'tv-popular': {
    titleKey: 'category.popular_series',
    mediaType: 'tv',
    genreId: 0,
  },
  'movies-upcoming': {
    titleKey: 'category.coming_soon',
    mediaType: 'movie',
    genreId: 0,
    defaultFilters: {
      releaseYear: CURRENT_YEAR,
      sortBy: 'primary_release_date.asc',
    },
  },
  'anime-trending': {
    titleKey: 'category.trending_anime',
    mediaType: 'tv',
    genreId: 16, // Animation
    keyword: 210024, // TMDB "anime" keyword
  },
};

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

function buildFilterParams(f: FilterValues, cat: CategoryDef): string {
  const base = buildDiscoverParams(f);
  const extra = new URLSearchParams();
  if (cat.originCountry) extra.set('originCountry', cat.originCountry);
  if (cat.keyword) extra.set('keyword', String(cat.keyword));
  const extraStr = extra.toString();
  return base + (extraStr ? `&${extraStr}` : '');
}

export default function CategoryPage() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const category = CATEGORIES[slug || ''];
  const [filters, setFilters] = useState<FilterValues>({ ...DEFAULT_FILTERS });
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset filters when slug changes
  useEffect(() => {
    if (!category) return;
    setFilters({ ...DEFAULT_FILTERS, ...category.defaultFilters });
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildUrl = useCallback(
    (page: number) => {
      if (!category) return '';
      const hasFilters =
        filters.sortBy !== 'popularity.desc' ||
        filters.voteAverageGte > 0 ||
        filters.releaseYear != null ||
        filters.hideRequested;
      if (category.defaultEndpoint && !hasFilters) {
        return `${category.defaultEndpoint}?page=${page}`;
      }
      const fp = buildFilterParams(filters, category);
      return `/tmdb/discover/${category.mediaType}/genre/${category.genreId}?page=${page}${fp}`;
    },
    [slug, filters], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const mapResult = useCallback(
    (r: TmdbMedia): TmdbMedia => ({
      ...r,
      media_type: r.media_type || category?.mediaType || (r.title ? 'movie' : 'tv'),
    }),
    [slug], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { results, loading, loadingMore, transitioning, page, totalPages } =
    usePaginatedDiscovery({
      buildUrl,
      filters,
      sentinelRef,
      routeKey: slug || '',
      mapResult,
    });

  // Client-side "hide requested" filter (only one that needs status data)
  const statuses = useMediaStatus(results);
  const displayResults = useMemo(() => {
    if (!filters.hideRequested) return results;
    return results.filter((item) => {
      const type = item.media_type || (item.title ? 'movie' : 'tv');
      const key = `${type}:${item.id}`;
      if (!(key in statuses)) return false; // status not loaded yet -- hide to prevent flash
      return statuses[key].statusCategory === 'UNAVAILABLE';
    });
  }, [results, filters.hideRequested, statuses]);

  if (!category) {
    return (
      <div className="max-w-[1800px] mx-auto px-4 sm:px-8 py-20 text-center">
        <p className="text-ndp-text-muted text-lg">{t('category.not_found')}</p>
        <Link to="/" className="btn-primary inline-block mt-4">
          {t('category.back_home')}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1800px] mx-auto px-4 sm:px-8 pt-4 pb-16">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        sortOptions={category.mediaType === 'tv' ? SORT_OPTIONS_TV : SORT_OPTIONS_MOVIE}
        title={t(category.titleKey)}
        backButton={
          <Link
            to="/"
            className="p-2 glass rounded-xl hover:bg-white/10 transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </Link>
        }
      />

      <div
        className={clsx(
          'transition-opacity duration-300',
          transitioning && 'opacity-40 pointer-events-none',
        )}
      >
        <MediaGrid media={displayResults} loading={loading} skeletonCount={21} />
      </div>

      {!loading && page < totalPages && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          {loadingMore && <Loader2 className="w-6 h-6 text-ndp-accent animate-spin" />}
        </div>
      )}
    </div>
  );
}
