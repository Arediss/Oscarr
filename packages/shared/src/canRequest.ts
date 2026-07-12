import { MEDIA_STATE_DISPLAY, type MediaStateCategory } from './mediaState.js';
import { ACTIVE_REQUEST_STATUSES, type RequestStatusKind } from './requestStatus.js';

/** Requestable when there's no ACTIVE request (the backend's duplicate rule) and the category allows it. */
export function canRequest(
  category: MediaStateCategory,
  userRequestStatus: RequestStatusKind | null,
): boolean {
  if (userRequestStatus !== null && (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(userRequestStatus)) {
    return false;
  }
  return MEDIA_STATE_DISPLAY[category].showsRequestCTA;
}
