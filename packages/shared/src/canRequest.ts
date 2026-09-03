import { MEDIA_STATE_DISPLAY, type MediaStateCategory } from './mediaState.js';
import { ACTIVE_REQUEST_STATUSES, type RequestStatusKind } from './requestStatus.js';

/**
 * Requestable when the user holds no active request and either the category allows it, or a
 * quality option is still free.
 *
 * The second half mirrors the detail page: `resolveButtonState` reads the quality path before the
 * transient states, so a title being fetched in one option can still be asked for in another. The
 * grids used to know only the category and said no, which is exactly the case reported in
 * discussion #228.
 *
 * The user's own active request still wins. Asking twice for the same option is what the backend
 * deduplicates on, and the grid has no picker to choose a different one with.
 */
export function canRequest(
  category: MediaStateCategory,
  userRequestStatus: RequestStatusKind | null,
  hasFreeQualityOption = false,
): boolean {
  if (userRequestStatus !== null && (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(userRequestStatus)) {
    return false;
  }
  return MEDIA_STATE_DISPLAY[category].showsRequestCTA || hasFreeQualityOption;
}
