import type { RequestStatusKind } from './requestStatus.js';
import type { MediaStateCategory } from './mediaState.js';

/** Wire availability object. Built only by buildAvailability() on the backend. */
export interface Availability {
  /** Canonical media category (from the connector, or BLACKLISTED override). */
  statusCategory: MediaStateCategory;
  /** Current user's request status for this media, if any. */
  requestStatus?: RequestStatusKind | null;
  requestId?: number | null;
}
