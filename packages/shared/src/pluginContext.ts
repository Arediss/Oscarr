/** Typed projections exposed to plugins via `PluginContext`. Kept in `@oscarr/shared` so
 *  plugin authors can import them from `@oscarr/shared` (same package the backend re-exports)
 *  and stay type-safe without poking into `packages/backend/src/...` internals.
 *
 *  Design rule: these are **projections**, not pass-throughs of Prisma models. We expose
 *  exactly what a plugin should see, never the raw DB shape. Adds to the projection are
 *  backwards-compatible; removals are breaking changes. Treat this file as a contract. */

import type { TmdbMedia } from './tmdb.js';
import type { MediaStateCategory } from './mediaState.js';

// ─── Media / Requests projections ───────────────────────────────────

/** Subset of the `Media` Prisma model exposed to plugins. No internal fields (serviceIds,
 *  availableAt timestamps, sync-state flags, etc.) — plugins get what they need to identify
 *  and display a piece of media, nothing more. */
export interface PluginMedia {
  id: number;
  tmdbId: number;
  tvdbId: number | null;
  mediaType: 'movie' | 'tv';
  title: string;
  /** Poster path as stored (relative TMDB path — plugins can build full URLs themselves). */
  posterPath: string | null;
  /** Canonical media category (closed MediaStateCategory vocabulary). */
  statusCategory: MediaStateCategory;
}

/** Subset of `MediaRequest` + its Media relation, exposed to plugins. Omits approvedById,
 *  rootFolder, qualityOptionId, updatedAt and other internal scheduling/audit fields. */
export interface PluginMediaRequest {
  id: number;
  userId: number;
  mediaType: 'movie' | 'tv';
  seasons: number[] | null;
  status: string;
  createdAt: string;
  media: PluginMedia;
}

/** Key format used by `ctx.media.batchStatus`: `${mediaType}:${tmdbId}`. Plugins can build it
 *  themselves without re-specifying the separator. */
export type PluginMediaBatchKey = `${'movie' | 'tv'}:${number}`;

export interface PluginMediaBatchStatus {
  /** Canonical media category (closed MediaStateCategory vocabulary). */
  statusCategory: MediaStateCategory;
  /** The requesting user's current request status for this media, if any. Null when the user
   *  hasn't requested it (used by `ctx.media.batchStatus` only when a userId is passed). */
  userRequestStatus: string | null;
  /** Shortcut: whether the user currently has an open / in-progress request (pending,
   *  approved, searching, processing). Lets plugins do a simple boolean check instead of
   *  matching against `ACTIVE_REQUEST_STATUSES`. */
  userHasActiveRequest: boolean;
}

// ─── TMDB helpers ───────────────────────────────────────────────────

/** A single row from `ctx.tmdb.search(query)`. TMDB's /search/multi returns a mix of
 *  movie / tv / person rows with heterogeneous fields; keeping it loose as `TmdbMedia` + the
 *  discriminator lets callers filter client-side without us pretending the shape is uniform. */
export type PluginTmdbSearchResult = TmdbMedia;

/** Paginated response shape wrapping `PluginTmdbSearchResult[]`. Matches TMDB's native
 *  envelope for `/search/multi`. */
export interface PluginTmdbSearchPage {
  page: number;
  results: PluginTmdbSearchResult[];
  total_pages: number;
  total_results: number;
}

// ─── Folder rules ───────────────────────────────────────────────────

/** Read-only view of a FolderRule row. Plugins can enumerate existing routing rules
 *  (e.g. to offer the same category picker as the web UI) but not mutate them. */
export interface PluginFolderRule {
  id: number;
  name: string;
  priority: number;
  mediaType: string;
  /** JSON-parsed conditions array. Shape matches the admin UI's routing-rule editor. */
  conditions: Array<{ field: string; operator: string; value: unknown }>;
  folderPath: string;
  seriesType: string | null;
  serviceId: number | null;
  enabled: boolean;
}

// ─── Event bus payloads ─────────────────────────────────────────────

/** Versioned envelope: plugins subscribe to a stable `v: 1` contract. Future payload changes
 *  emit alongside `v: 2` etc. — no silent breakage.
 *
 *  **Metadata contract (important):** `metadata` is forwarded verbatim from whatever the
 *  caller of `safeUserNotify` passed in — it reaches every plugin subscribed to the event,
 *  regardless of that plugin's `users:read` / `requests:read` capabilities. Core callers must
 *  treat metadata as plugin-visible: no PII, no secrets, no raw error objects. Current core
 *  payloads (`{ mediaId, tmdbId, mediaType, msgParams }`) are safe; keep future additions on
 *  the same side of the line. */
export interface PluginUserNotificationCreatedV1 {
  v: 1;
  userId: number;
  type: string;
  /** Raw value as stored in the DB. May be an i18n key (`notifications.msg.*`) or a literal
   *  string (e.g. a media title). Plugins should prefer `titleText` / `messageText` for
   *  display; these raw fields are kept on the contract so subscribers that want to
   *  re-translate against a per-user locale can do so. */
  title: string;
  message: string;
  /** Pre-translated text resolved against the instance language at emit time. Same shape
   *  the web frontend ultimately renders. Plugins should display these directly. */
  titleText?: string;
  messageText?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Emitted when a piece of media becomes available in the library (post-sync confirm). The
 *  `requesterUserIds` list enumerates every user whose request was fulfilled by this event,
 *  so broadcast-style plugins can translate one "media available" fact into N per-user
 *  side-effects without extra DB queries.
 *
 *  **Privacy:** subscribers receive raw user IDs regardless of their capability declarations.
 *  Treat them as confidential — don't log them to external systems or expose them through
 *  plugin APIs without explicit admin opt-in. */
export interface PluginMediaAvailableV1 {
  v: 1;
  mediaId: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string | null;
  requesterUserIds: number[];
}
