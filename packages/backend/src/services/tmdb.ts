import axios from 'axios';
import { attachAxiosRetry } from '../utils/fetchWithRetry.js';
import { getCached, setCache } from '../utils/cache.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
// Public read-only TMDB v4 token (scopes: api_read) — not a secret. Shipped as a fallback so
// `docker run` works zero-config, but every install sharing this same token risks IP-level
// throttling or revocation by TMDB. Admins should set TMDB_API_TOKEN to use their own.
// NOSONAR + codeql/jwt-token alerts on the built artefact are dismissed in the UI.
const TMDB_DEFAULT_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJkODg0ZWJlNzE0NTU4NWI0ZDZkYTAzNDVlM2NjMDcyMiIsIm5iZiI6MTU0NzI5NzAxOS41MjgsInN1YiI6IjVjMzllMGZiYzNhMzY4MDg0ZjQ2YTE1YyIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.0HM5S5_3ufPtWrzU_zt7ZNEFKinftqAq1n9Nk3y0eOw';
const TMDB_TOKEN = process.env.TMDB_API_TOKEN || TMDB_DEFAULT_TOKEN;
if (!process.env.TMDB_API_TOKEN) {
  // eslint-disable-next-line no-console
  console.warn('[TMDB] No TMDB_API_TOKEN set — falling back to the bundled public token. ' +
    'Get your own at https://www.themoviedb.org/settings/api to avoid shared rate limits.');
}

import { prisma } from '../utils/prisma.js';

const DEFAULT_LANG = 'en';

/** Get instance languages from AppSettings, cached for 5 min */
let _cachedLangs: string[] | null = null;
let _cachedAt = 0;

/** Invalidate the in-memory language cache (call after language settings change) */
export function invalidateLanguageCache(): void {
  _cachedLangs = null;
  _cachedAt = 0;
}

export async function getInstanceLanguages(): Promise<string[]> {
  if (_cachedLangs && Date.now() - _cachedAt < 300_000) return _cachedLangs;
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { instanceLanguages: true } });
  const parsed: string[] = settings?.instanceLanguages ? JSON.parse(settings.instanceLanguages) : ['en'];
  _cachedLangs = parsed.includes('en') ? parsed : [...parsed, 'en'];
  _cachedAt = Date.now();
  return _cachedLangs;
}

function normalizeLang(lang?: string): string {
  const supported = _cachedLangs || ['en'];
  if (!lang) return supported[0] || DEFAULT_LANG;
  const short = lang.split('-')[0].toLowerCase();
  return supported.includes(short) ? short : supported[0] || DEFAULT_LANG;
}

const LANG_TO_LOCALE: Record<string, string> = {
  en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT',
  pt: 'pt-BR', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN',
  nl: 'nl-NL', sv: 'sv-SE', da: 'da-DK', no: 'nb-NO', fi: 'fi-FI',
  pl: 'pl-PL', tr: 'tr-TR', ar: 'ar-SA', hi: 'hi-IN', th: 'th-TH',
};

const LANG_TO_COUNTRY: Record<string, string> = {
  en: 'US', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'BR',
  ru: 'RU', ja: 'JP', ko: 'KR', zh: 'CN', nl: 'NL', sv: 'SE',
  da: 'DK', no: 'NO', fi: 'FI', pl: 'PL', tr: 'TR', ar: 'SA',
  hi: 'IN', th: 'TH',
};

function toTmdbLocale(lang: string): string {
  return LANG_TO_LOCALE[lang] || 'en-US';
}

export function getTmdbApi(lang = DEFAULT_LANG) {
  const instance = axios.create({
    baseURL: TMDB_BASE,
    timeout: 10000,
    headers: {
      Authorization: `Bearer ${TMDB_TOKEN}`,
    },
    params: {
      language: toTmdbLocale(lang),
    },
  });
  // Transient-error retry: a 503 or cloudflare hiccup doesn't kill the waiting row.
  return attachAxiosRetry(instance, 'TMDB');
}

// Type contracts moved to @oscarr/shared (TmdbCollection, TmdbMovie, TmdbTv, TmdbSeason,
// TmdbCast, TmdbCrew, TmdbVideo, TmdbPerson, TmdbMediaResult, TmdbCollectionRef, TmdbMedia).
// This file re-exports them so legacy `import { TmdbMovie } from 'services/tmdb.js'` paths
// keep working; direct @oscarr/shared imports are encouraged in new code.
export type {
  TmdbCollection, TmdbCollectionRef, TmdbMovie, TmdbTv, TmdbSeason, TmdbCast, TmdbCrew,
  TmdbVideo, TmdbMedia, TmdbMediaResult, TmdbPerson,
} from '@oscarr/shared';
import type { TmdbMovie, TmdbTv, TmdbMediaResult, TmdbPerson, TmdbCollection } from '@oscarr/shared';

/** Extract keywords array from movie or TV details (different TMDB response shapes) */
export function extractKeywords(details: TmdbMovie | TmdbTv): { id: number; name: string }[] {
  const movie = details as TmdbMovie;
  const tv = details as TmdbTv;
  return movie.keywords?.keywords ?? tv.keywords?.results ?? [];
}

/** Ratings considered explicitly adult/NSFW (not just age-restricted) */
const MATURE_RATINGS = new Set([
  'NC-17', 'X', 'XXX',         // US explicit
  'VM18',                       // IT explicit
]);

/** Non-informative ratings to skip when extracting */
const SKIP_RATINGS = new Set(['NR', 'Not Rated', '']);

/** Build country priority list: instance languages first, then fallback */
function getRatingCountries(): string[] {
  const langs = _cachedLangs || ['en'];
  const instanceCountries = langs.map(l => LANG_TO_COUNTRY[l]).filter(Boolean);
  const fallback = ['US', 'FR', 'DE', 'BR', 'RU', 'IT'];
  // Instance countries first, then remaining fallbacks (deduplicated)
  return [...new Set([...instanceCountries, ...fallback])];
}

/** Extract the most relevant content rating from movie or TV details */
export async function extractContentRating(details: TmdbMovie | TmdbTv): Promise<string | null> {
  // Ensure instance languages are loaded before determining country priority
  await getInstanceLanguages();
  const movie = details as TmdbMovie;
  const tv = details as TmdbTv;

  // TV: content_ratings
  const ratingCountries = getRatingCountries();
  if (tv.content_ratings?.results?.length) {
    for (const country of ratingCountries) {
      const match = tv.content_ratings.results.find((r) => r.iso_3166_1 === country);
      if (match?.rating && !SKIP_RATINGS.has(match.rating)) return match.rating;
    }
    // Fallback to first non-skipped rating
    const fallback = tv.content_ratings.results.find((r) => r.rating && !SKIP_RATINGS.has(r.rating));
    return fallback?.rating ?? null;
  }

  // Movie: release_dates (certifications)
  if (movie.release_dates?.results?.length) {
    for (const country of ratingCountries) {
      const countryData = movie.release_dates.results.find((r) => r.iso_3166_1 === country);
      if (countryData) {
        const cert = countryData.release_dates.find((rd) => rd.certification && !SKIP_RATINGS.has(rd.certification))?.certification;
        if (cert) return cert;
      }
    }
  }

  return null;
}

/** Check if a content rating is considered mature/NSFW */
export function isMatureRating(rating: string | null): boolean {
  if (!rating) return false;
  return MATURE_RATINGS.has(rating);
}

// TmdbSeason, TmdbCast, TmdbCrew, TmdbVideo, TmdbMediaResult: moved to @oscarr/shared
// (re-exported at the top of this file for legacy callers).

async function cachedRequest<T>(cacheKey: string, fetcher: () => Promise<T>, ttlHours = 24): Promise<T> {
  const cached = await getCached<T>(cacheKey);
  if (cached) return cached;
  const data = await fetcher();
  await setCache(cacheKey, data, ttlHours);
  return data;
}

export async function getTrending(page = 1, lang?: string): Promise<{ results: TmdbMediaResult[]; total_pages: number; total_results: number }> {
  const l = normalizeLang(lang);
  return cachedRequest(`trending:all:week:${page}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get('/trending/all/week', { params: { page } });
    return data;
  }, 6);
}

export async function getPopularMovies(page = 1, lang?: string) {
  const l = normalizeLang(lang);
  return cachedRequest(`popular:movies:${page}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get('/movie/popular', { params: { page } });
    return data;
  }, 6);
}

export async function getPopularTv(page = 1, lang?: string) {
  const l = normalizeLang(lang);
  return cachedRequest(`popular:tv:${page}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get('/tv/popular', { params: { page } });
    return data;
  }, 6);
}

const ANIME_KEYWORD_ID = 210024; // TMDB keyword "anime"

export async function getTrendingAnime(page = 1, lang?: string) {
  const l = normalizeLang(lang);
  return cachedRequest(`trending:anime:${page}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get('/discover/tv', {
      params: {
        with_keywords: ANIME_KEYWORD_ID,
        sort_by: 'popularity.desc',
        page,
      },
    });
    return data;
  }, 6);
}

export async function getUpcomingMovies(page = 1, lang?: string) {
  const l = normalizeLang(lang);
  return cachedRequest(`upcoming:movies:${page}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get('/movie/upcoming', { params: { page } });
    return data;
  }, 6);
}

export async function searchMulti(query: string, page = 1, lang?: string) {
  const l = normalizeLang(lang);
  return cachedRequest(`search:${query}:${page}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get('/search/multi', { params: { query, page } });
    return data;
  }, 1);
}

// TmdbPerson: moved to @oscarr/shared. The shared definition uses the loose `TmdbMedia`
// shape in combined_credits.{cast,crew} instead of `TmdbMovie & TmdbTv & …` — more honest
// about the fact that those entries carry mixed movie+tv rows with partial data.

export async function getPersonDetails(personId: number, lang?: string): Promise<TmdbPerson> {
  const l = normalizeLang(lang);
  return cachedRequest(`person:${personId}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get(`/person/${personId}`, {
      params: { append_to_response: 'combined_credits' },
    });
    return data;
  }, 24);
}

export async function getMovieDetails(movieId: number, lang?: string): Promise<TmdbMovie> {
  const l = normalizeLang(lang);
  return cachedRequest(`movie:${movieId}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get(`/movie/${movieId}`, {
      params: { append_to_response: 'credits,external_ids,videos,keywords,release_dates' },
    });
    return data;
  }, 24);
}

export async function getTvDetails(tvId: number, lang?: string): Promise<TmdbTv> {
  const l = normalizeLang(lang);
  return cachedRequest(`tv:${tvId}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get(`/tv/${tvId}`, {
      params: { append_to_response: 'credits,external_ids,videos,keywords,content_ratings' },
    });
    return data;
  }, 24);
}

export async function getMovieRecommendations(movieId: number, lang?: string) {
  const l = normalizeLang(lang);
  return cachedRequest(`movie:${movieId}:reco:${l}`, async () => {
    const { data } = await getTmdbApi(l).get(`/movie/${movieId}/recommendations`);
    return data;
  }, 24);
}

export async function getTvRecommendations(tvId: number, lang?: string) {
  const l = normalizeLang(lang);
  return cachedRequest(`tv:${tvId}:reco:${l}`, async () => {
    const { data } = await getTmdbApi(l).get(`/tv/${tvId}/recommendations`);
    return data;
  }, 24);
}

export async function getCollection(collectionId: number, lang?: string): Promise<TmdbCollection> {
  // Self-validate before hitting TMDB — the type says `number` but the value is user-controlled
  // at the edge (route param / body). Coercing to a safe integer here keeps the URL template
  // obviously scanner-safe and protects future callers that might forget to validate upstream.
  const safeId = Math.floor(Number(collectionId));
  if (!Number.isFinite(safeId) || safeId < 1) {
    throw new Error(`Invalid TMDB collectionId: ${collectionId}`);
  }
  const l = normalizeLang(lang);
  return cachedRequest(`collection:${safeId}:${l}`, async () => {
    const { data } = await getTmdbApi(l).get(`/collection/${safeId}`);
    return data;
  }, 48);
}

export interface DiscoverFilters {
  sortBy?: string;
  voteAverageGte?: number;
  releaseDateGte?: string;
  releaseDateLte?: string;
  originCountry?: string;
  keyword?: number;
}

const ALLOWED_SORT = new Set([
  'popularity.desc', 'popularity.asc',
  'vote_average.desc', 'vote_average.asc',
  'primary_release_date.desc', 'primary_release_date.asc',
  'first_air_date.desc', 'first_air_date.asc',
]);

export async function discoverByGenre(
  mediaType: 'movie' | 'tv', genreId: number, page = 1, lang?: string, filters?: DiscoverFilters,
) {
  const l = normalizeLang(lang);
  const sortBy = filters?.sortBy && ALLOWED_SORT.has(filters.sortBy) ? filters.sortBy : 'popularity.desc';
  const cacheKey = `discover:${mediaType}:genre:${genreId}:${page}:${l}:${sortBy}:${filters?.voteAverageGte || 0}:${filters?.releaseDateGte || ''}:${filters?.releaseDateLte || ''}:${filters?.originCountry || ''}:${filters?.keyword || ''}`;

  return cachedRequest(cacheKey, async () => {
    const dateGte = mediaType === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
    const dateLte = mediaType === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte';
    const params: Record<string, unknown> = {
      sort_by: sortBy,
      page,
    };
    if (genreId > 0) params.with_genres = genreId;
    if (filters?.voteAverageGte) params['vote_average.gte'] = filters.voteAverageGte;
    if (filters?.releaseDateGte) params[dateGte] = filters.releaseDateGte;
    if (filters?.releaseDateLte) params[dateLte] = filters.releaseDateLte;
    if (filters?.originCountry) params.with_origin_country = filters.originCountry;
    if (filters?.keyword) params.with_keywords = filters.keyword;
    // Require minimum votes when sorting by rating to avoid obscure titles
    if (sortBy.startsWith('vote_average')) params['vote_count.gte'] = 50;

    // Static path selection — mediaType is narrowed to 'movie' | 'tv' at the type level, but
    // the template literal was flagged by CodeQL taint analysis as SSRF-reachable. Picking from
    // literal strings via equality makes the allowlist obvious to both humans and scanners.
    const discoverPath = mediaType === 'movie' ? '/discover/movie' : '/discover/tv';
    const { data } = await getTmdbApi(l).get(discoverPath, { params });
    return data;
  }, 12);
}

/** Discover both movie + tv, merge by popularity, return a single page */
export async function discoverMixed(page = 1, lang?: string, filters?: DiscoverFilters) {
  const l = normalizeLang(lang);
  const sortBy = filters?.sortBy && ALLOWED_SORT.has(filters.sortBy) ? filters.sortBy : 'popularity.desc';
  const cacheKey = `discover:mixed:${page}:${l}:${sortBy}:${filters?.voteAverageGte || 0}:${filters?.releaseDateGte || ''}:${filters?.releaseDateLte || ''}:${filters?.originCountry || ''}:${filters?.keyword || ''}`;

  return cachedRequest(cacheKey, async () => {
    const [movies, tv] = await Promise.all([
      discoverByGenre('movie', 0, page, l, filters),
      discoverByGenre('tv', 0, page, l, filters),
    ]);
    const merged = [
      ...(movies.results || []).map((r: TmdbMediaResult) => ({ ...r, media_type: 'movie' })),
      ...(tv.results || []).map((r: TmdbMediaResult) => ({ ...r, media_type: 'tv' })),
    ];
    const desc = sortBy.endsWith('.desc');
    merged.sort((a, b) => {
      const ra = a as Record<string, unknown>;
      const rb = b as Record<string, unknown>;
      let va: number | string, vb: number | string;
      if (sortBy.startsWith('vote_average')) {
        va = (ra.vote_average as number) ?? 0;
        vb = (rb.vote_average as number) ?? 0;
      } else if (sortBy.startsWith('primary_release_date') || sortBy.startsWith('first_air_date')) {
        va = (ra.release_date || ra.first_air_date || '') as string;
        vb = (rb.release_date || rb.first_air_date || '') as string;
        return desc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb));
      } else {
        va = (ra.popularity as number) ?? 0;
        vb = (rb.popularity as number) ?? 0;
      }
      return desc ? vb - va : va - vb;
    });
    merged.splice(20);

    return {
      results: merged,
      total_pages: Math.min(movies.total_pages || 1, tv.total_pages || 1),
      total_results: (movies.total_results || 0) + (tv.total_results || 0),
    };
  }, 1);
}

const GENRE_IDS = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53, 10752, 37];

export async function getGenreBackdrops(): Promise<Record<number, string | null>> {
  return cachedRequest('genre-backdrops', async () => {
    const map: Record<number, string | null> = {};
    const used = new Set<string>();
    for (const id of GENRE_IDS) {
      try {
        const { data } = await getTmdbApi().get('/discover/movie', {
          params: { with_genres: id, sort_by: 'popularity.desc', page: 1 },
        });
        const hit = data.results?.find((m: { backdrop_path: string | null }) => m.backdrop_path && !used.has(m.backdrop_path));
        map[id] = hit?.backdrop_path ?? null;
        if (hit?.backdrop_path) used.add(hit.backdrop_path);
      } catch {
        map[id] = null;
      }
    }
    return map;
  }, 24);
}
