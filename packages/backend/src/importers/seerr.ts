import type {
  AdapterCredentials,
  CanonicalRequest,
  CanonicalUser,
  ImportAdapter,
  ImportSource,
} from './types.js';

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

const PAGE_SIZE = 100;

function buildUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

async function seerrFetch<T>(creds: AdapterCredentials, path: string): Promise<T> {
  const res = await fetch(buildUrl(creds.url, path), {
    headers: {
      Accept: 'application/json',
      'X-Api-Key': creds.apiKey,
    },
  });
  if (!res.ok) {
    throw new Error(`Seerr ${path} failed: HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAllPages<T>(creds: AdapterCredentials, path: string): Promise<T[]> {
  const out: T[] = [];
  let skip = 0;
  // Hard cap iterations so a malformed pageInfo can't loop forever.
  for (let i = 0; i < 1000; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await seerrFetch<PageEnvelope<T>>(
      creds,
      `${path}${sep}take=${PAGE_SIZE}&skip=${skip}`,
    );
    out.push(...page.results);
    if (page.results.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return out;
}

function mapStatus(code: number): CanonicalRequest['status'] {
  switch (code) {
    case 2:
      return 'approved';
    case 3:
      return 'declined';
    default:
      return 'pending';
  }
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
