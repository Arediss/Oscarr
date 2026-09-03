import type {
  AdapterCredentials,
  CanonicalRequest,
  CanonicalUser,
  ImportAdapter,
  ImportSource,
} from './types.js';
import { paginate, limitsFromEnv } from './paginate.js';
import { logEvent } from '../utils/logEvent.js';

/**
 * Adapter for the Seerr family (Overseerr / Jellyseerr / Seerr). All three
 * forks share the `/api/v1/*` surface for status, user and request listing,
 * authenticated via the `X-Api-Key` header. Differences live in optional
 * fields that we tolerate via undefined-checks.
 */

interface SeerrStatus {
  version: string;
  commitTag?: string;
}

interface SeerrUser {
  id: number;
  email: string | null;
  username: string | null;
  displayName?: string | null;
  plexId?: number | string | null;
  jellyfinUserId?: string | null;
  /** Overseerr permission bitmask. ADMIN=2 is the bit we care about. */
  permissions?: number;
}

interface SeerrSeason {
  seasonNumber: number;
  status: number;
}

interface SeerrMedia {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  status?: number;
}

interface SeerrRequest {
  id: number;
  /** 1=pending 2=approved 3=declined */
  status: number;
  media: SeerrMedia;
  requestedBy: { id: number };
  seasons?: SeerrSeason[];
  createdAt: string;
}

interface PageEnvelope<T> {
  results: T[];
  pageInfo?: { page: number; pages: number; results: number };
}
import { trimTrailingSlashes } from '../utils/trimTrailingSlashes.js';

function buildUrl(base: string, path: string): string {
  return `${trimTrailingSlashes(base)}${path}`;
}

/** Per-request ceiling. Without one, a Seerr instance that accepts the connection and then goes
 *  quiet parks the import forever — `fetch` has no default timeout. */
const REQUEST_TIMEOUT_MS = 20_000;

async function seerrFetch<T>(creds: AdapterCredentials, path: string): Promise<T> {
  const res = await fetch(buildUrl(creds.url, path), {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': creds.apiKey,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Seerr ${path} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAllPages<T>(creds: AdapterCredentials, path: string): Promise<T[]> {
  const rows = await paginate<T>(
    (skip, take) => {
      const sep = path.includes('?') ? '&' : '?';
      return seerrFetch<PageEnvelope<T>>(creds, `${path}${sep}take=${take}&skip=${skip}`);
    },
    limitsFromEnv(),
    path,
  );
  // The volume is the number nobody had before a migration, and the one every ceiling should be
  // set against. Cheap to record, and it turns "did it all come across?" into a lookup.
  logEvent('info', 'Import', `Seerr ${path}: ${rows.length} rows fetched`)
    .catch(() => { /* never fail an import over its own breadcrumb */ });
  return rows;
}

/** Map Overseerr's MediaRequestStatus enum to Oscarr's request status. The enum has grown
 *  over Overseerr versions (1=pending, 2=approved, 3=declined, 4=failed/completed depending
 *  on fork) so we whitelist only the two unambiguous codes (pending, declined) and treat
 *  anything else as approved — a request that's been moved past the pending tray by an admin
 *  was, by definition, accepted, regardless of what happened downstream in Radarr/Sonarr. */
function mapStatus(code: number): CanonicalRequest['status'] {
  if (code === 1) return 'pending';
  if (code === 3) return 'declined';
  return 'approved';
}

/** Overseerr media.status: 5 = available, 4 = partially available. */
function isAvailable(media: SeerrMedia): boolean {
  return media.status === 5 || media.status === 4;
}

function makeAdapter(source: ImportSource): ImportAdapter {
  return {
    source,

    async probe(creds) {
      const status = await seerrFetch<SeerrStatus>(creds, '/api/v1/status');
      if (!status.version) {
        throw new Error('Source responded but did not look like a Seerr-family server.');
      }
      return { version: status.version };
    },

    async fetchUsers(creds) {
      const raw = await fetchAllPages<SeerrUser>(creds, '/api/v1/user');
      return raw.map((u) => ({
        sourceId: String(u.id),
        email: u.email ?? null,
        displayName: u.displayName ?? u.username ?? null,
        plexId: u.plexId != null ? String(u.plexId) : null,
        jellyfinId: u.jellyfinUserId ?? null,
        // Overseerr permission bit 2 = ADMIN. Bitwise check.
        isAdmin: (u.permissions ?? 0) === 2 || ((u.permissions ?? 0) & 2) === 2,
      }));
    },

    async fetchRequests(creds) {
      const raw = await fetchAllPages<SeerrRequest>(creds, '/api/v1/request');
      return raw.map((r) => ({
        sourceId: String(r.id),
        requesterSourceId: String(r.requestedBy.id),
        tmdbId: r.media.tmdbId,
        mediaType: r.media.mediaType,
        seasons: r.seasons?.map((s) => s.seasonNumber),
        // If Overseerr already marks the media available, prefer that over
        // the request workflow status — it reflects current reality.
        status: isAvailable(r.media) ? 'available' : mapStatus(r.status),
        createdAt: new Date(r.createdAt),
      }));
    },
  };
}

export const overseerrAdapter = makeAdapter('overseerr');
export const jellyseerrAdapter = makeAdapter('jellyseerr');
export const seerrAdapter = makeAdapter('seerr');
