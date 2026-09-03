import { prisma } from '../utils/prisma.js';
import { parseServiceConfig } from '../utils/services.js';
import { logEvent } from '../utils/logEvent.js';
import { trimTrailingSlashes } from '../utils/trimTrailingSlashes.js';

/**
 * Reads what is actually present in the user's media server library.
 *
 * Oscarr has never had this: the Plex provider only does authentication and user sharing, so
 * "available" could only ever mean "the *arr reported a file". That is right most of the time and
 * wrong exactly when it hurts — the library has not been rescanned, and the user clicks a title
 * their player cannot find.
 *
 * Titles are joined on the TMDB/TVDB ids Plex exposes as `Guid`, never on file paths: paths differ
 * between the *arr's view and the media server's view as soon as either runs in a container.
 */

export interface LibraryEntry {
  tmdbId: number | null;
  tvdbId: number | null;
  /** 'movie' | 'tv', derived from the section type. */
  mediaType: 'movie' | 'tv';
}

interface PlexGuid { id?: string }

interface PlexItem {
  ratingKey?: string | number;
  Guid?: PlexGuid[];
}

interface PlexSection {
  key?: string;
  type?: string;
}

const PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 20_000;

function parseGuids(guids: PlexGuid[] | undefined): { tmdbId: number | null; tvdbId: number | null } {
  let tmdbId: number | null = null;
  let tvdbId: number | null = null;
  for (const g of guids ?? []) {
    const id = g.id ?? '';
    if (id.startsWith('tmdb://')) {
      const n = Number.parseInt(id.slice(7), 10);
      if (Number.isFinite(n)) tmdbId = n;
    } else if (id.startsWith('tvdb://')) {
      const n = Number.parseInt(id.slice(7), 10);
      if (Number.isFinite(n)) tvdbId = n;
    }
  }
  return { tmdbId, tvdbId };
}

async function plexGet(baseUrl: string, token: string, path: string, params: Record<string, string | number> = {}) {
  const url = new URL(path, trimTrailingSlashes(baseUrl) + '/');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Plex-Token': token },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Plex ${path} → HTTP ${res.status}`);
    return await res.json() as { MediaContainer?: Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}

/** Movie and show sections only — music and photo libraries have nothing Oscarr can match. */
async function plexSections(baseUrl: string, token: string): Promise<PlexSection[]> {
  const body = await plexGet(baseUrl, token, 'library/sections');
  const dirs = (body.MediaContainer?.Directory ?? []) as PlexSection[];
  return dirs.filter((d) => d.type === 'movie' || d.type === 'show');
}

/** One section, paginated. `includeGuids=1` is what surfaces the tmdb/tvdb ids. */
async function plexSectionItems(baseUrl: string, token: string, section: PlexSection): Promise<LibraryEntry[]> {
  const mediaType: 'movie' | 'tv' = section.type === 'movie' ? 'movie' : 'tv';
  const entries: LibraryEntry[] = [];
  let offset = 0;

  for (;;) {
    const body = await plexGet(baseUrl, token, `library/sections/${section.key}/all`, {
      includeGuids: 1,
      'X-Plex-Container-Start': offset,
      'X-Plex-Container-Size': PAGE_SIZE,
    });
    const items = (body.MediaContainer?.Metadata ?? []) as PlexItem[];
    for (const item of items) {
      const { tmdbId, tvdbId } = parseGuids(item.Guid);
      if (tmdbId !== null || tvdbId !== null) entries.push({ tmdbId, tvdbId, mediaType });
    }
    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return entries;
}

/** Null when no usable Plex server is configured — the caller treats that as "cannot confirm". */
async function plexCredentials(): Promise<{ url: string; token: string } | null> {
  const service = await prisma.service.findFirst({ where: { type: 'plex', enabled: true } });
  if (!service) return null;
  const config = parseServiceConfig(service.config);
  if (!config.url || !config.token) return null;
  return { url: config.url, token: config.token };
}

/**
 * Everything the configured media server currently holds.
 *
 * Only Plex is implemented. Jellyfin and Emby are configured in Oscarr for authentication only,
 * and their library APIs have not been verified here — returning null for them is deliberate, so
 * an unverified integration can never silently mark a whole library as unconfirmed.
 */
export async function readLibrary(): Promise<LibraryEntry[] | null> {
  const creds = await plexCredentials();
  if (!creds) return null;

  let sections: PlexSection[];
  try {
    sections = await plexSections(creds.url, creds.token);
  } catch (err) {
    // No section list means we learned nothing at all.
    logEvent('warn', 'Library', `Media server library scan failed: ${(err as Error).message}`);
    return null;
  }

  // Per-section isolation. A full library is several paginated requests; wrapping them in one
  // try/catch meant a single hiccup discarded thousands of titles and reported a clean zero.
  // Partial results are safe here because libraryConfirmedAt is a persistent stamp: a section that
  // failed simply is not refreshed this round, and everything it confirmed before stays confirmed.
  const all: LibraryEntry[] = [];
  let failed = 0;
  for (const section of sections) {
    try {
      all.push(...await plexSectionItems(creds.url, creds.token, section));
    } catch (err) {
      failed++;
      logEvent('warn', 'Library', `Library section ${section.key} unreadable, skipped: ${(err as Error).message}`);
    }
  }

  // Every section failing is indistinguishable from an outage — say so rather than reporting an
  // empty library, which would read as "nothing is confirmed".
  if (failed > 0 && all.length === 0) return null;
  return all;
}

/**
 * Stamps `libraryConfirmedAt` on every media the server currently holds.
 *
 * A failed or unconfigured scan returns 0 and stamps nothing: absence of evidence must not be read
 * as evidence of absence, or one unreachable Plex would flip an entire library back to IMPORTED.
 */
export async function syncLibraryConfirmations(): Promise<{ scanned: number; confirmed: number }> {
  const entries = await readLibrary();
  if (entries === null) return { scanned: 0, confirmed: 0 };

  const now = new Date();
  let confirmed = 0;

  // Grouped by media type so a tmdbId collision across namespaces cannot confirm the wrong row.
  for (const mediaType of ['movie', 'tv'] as const) {
    const forType = entries.filter((e) => e.mediaType === mediaType);
    const tmdbIds = [...new Set(forType.map((e) => e.tmdbId).filter((v): v is number => v !== null))];
    const tvdbIds = [...new Set(forType.map((e) => e.tvdbId).filter((v): v is number => v !== null))];

    if (tmdbIds.length > 0) {
      const { count } = await prisma.media.updateMany({
        where: { mediaType, tmdbId: { in: tmdbIds } },
        data: { libraryConfirmedAt: now },
      });
      confirmed += count;
    }
    // Sonarr keys on TVDB, so a series Plex knows by tvdb id alone still has to be reachable.
    if (mediaType === 'tv' && tvdbIds.length > 0) {
      const { count } = await prisma.media.updateMany({
        where: { mediaType, tvdbId: { in: tvdbIds }, libraryConfirmedAt: { not: now } },
        data: { libraryConfirmedAt: now },
      });
      confirmed += count;
    }
  }

  logEvent('info', 'Library', `Media server library scan: ${entries.length} title(s) seen, ${confirmed} media row(s) confirmed`);
  return { scanned: entries.length, confirmed };
}
