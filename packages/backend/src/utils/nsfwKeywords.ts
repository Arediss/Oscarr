import { prisma } from './prisma.js';

/**
 * The set of TMDB keyword ids an admin has tagged `nsfw`.
 *
 * Two paths need it — `/media/nsfw-ids` (whole-library sweep) and the TMDB list annotator that
 * runs on every search and discovery page. The second one re-read the table on every request
 * while the first cached its own answer for five minutes, so the same rarely-changing rows were
 * fetched over and over on the hottest path in the app.
 *
 * Invalidated explicitly on keyword CRUD rather than trusted to expire, so tagging a keyword
 * takes effect immediately.
 */
const TTL_MS = 5 * 60 * 1000;

let cache: { ids: Set<number>; expiresAt: number } | null = null;

export async function getNsfwKeywordIds(): Promise<Set<number>> {
  if (cache && Date.now() < cache.expiresAt) return cache.ids;

  const rows = await prisma.keyword.findMany({ where: { tag: 'nsfw' }, select: { tmdbId: true } });
  const ids = new Set(rows.map((k) => k.tmdbId));
  cache = { ids, expiresAt: Date.now() + TTL_MS };
  return ids;
}

export function invalidateNsfwKeywordIds(): void {
  cache = null;
}
