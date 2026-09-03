import type { RequestStatusKind } from './requestStatus.js';
import type { MediaStateCategory } from './mediaState.js';

/** Wire availability object. Built only by buildAvailability() on the backend. */
export interface Availability {
  /** Canonical media category (from the connector, or BLACKLISTED override). */
  statusCategory: MediaStateCategory;
  /** Current user's request status for this media, if any. */
  requestStatus?: RequestStatusKind | null;
  requestId?: number | null;
  /**
   * At least one configured quality option has no active request on this title.
   *
   * Computed server-side because it needs both halves: which options exist, and which are already
   * taken by *anyone*. A grid only ever receives the current user's own request, so it could never
   * work this out on its own — which is why grids offered nothing on a title someone else had
   * already asked for, whatever was still free (discussion #228).
   */
  hasFreeQualityOption?: boolean;
}
