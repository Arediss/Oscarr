/**
 * Canonical shapes the import pipeline operates on. Each adapter
 * (Seerr-family, Ombi, …) is responsible for translating its own API
 * payloads into these types so the runner stays source-agnostic.
 */

export type ImportSource = 'overseerr' | 'jellyseerr' | 'seerr' | 'ombi';

export interface CanonicalUser {
  /** Stable id from the source (e.g. Overseerr user.id). Used to deduplicate
   *  during preview and to anchor the user-mapping table. */
  sourceId: string;
  email: string | null;
  displayName: string | null;
  /** External provider IDs we can match against existing UserProvider rows. */
  plexId?: string | null;
  jellyfinId?: string | null;
  /** Source role: only used to flag admins so we don't silently elevate. */
  isAdmin: boolean;
}

export interface CanonicalRequest {
  sourceId: string;
  /** Foreign key into the matching CanonicalUser via sourceId. */
  requesterSourceId: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  /** Season numbers requested for TV (omit for movies / all-seasons request). */
  seasons?: number[];
  /** Normalised status: pending | approved | declined | available. */
  status: 'pending' | 'approved' | 'declined' | 'available';
  /** Source-side timestamp; written verbatim into MediaRequest.createdAt. */
  createdAt: Date;
}

export type UserMatchStrategy = 'plex_id' | 'jellyfin_id' | 'email' | 'manual' | 'create' | 'skip';

export interface UserMatch {
  sourceUser: CanonicalUser;
  /** null = needs a manual decision in the wizard. */
  oscarrUserId: number | null;
  strategy: UserMatchStrategy;
}

export interface RequestConflict {
  sourceRequest: CanonicalRequest;
  /** "duplicate" = same (tmdbId, mediaType, requester) already exists in Oscarr.
   *  "no_user" = requester didn't match and isn't being created.
   *  "tmdb_missing" = TMDB lookup failed for this id. */
  reason: 'duplicate' | 'no_user' | 'tmdb_missing';
}

export interface ImportPreview {
  source: ImportSource;
  users: {
    total: number;
    matched: UserMatch[];
    needsDecision: UserMatch[];
  };
  requests: {
    total: number;
    importable: number;
    conflicts: RequestConflict[];
  };
}

export interface AdapterCredentials {
  url: string;
  apiKey: string;
}

export interface ImportAdapter {
  source: ImportSource;
  /** Probe the source — verify URL + API key reach a compatible server.
   *  Throws with a user-readable message on failure. */
  probe(creds: AdapterCredentials): Promise<{ version: string }>;
  fetchUsers(creds: AdapterCredentials): Promise<CanonicalUser[]>;
  fetchRequests(creds: AdapterCredentials): Promise<CanonicalRequest[]>;
}

export interface ExecuteResult {
  usersCreated: number;
  usersLinked: number;
  requestsCreated: number;
  requestsSkipped: number;
}
