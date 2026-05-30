import { MEDIA_STATE_DISPLAY, type MediaStateCategory } from './mediaState.js';
import type { RequestStatusKind } from './requestStatus.js';

/** Requestable when the user has no active request and the category's CTA policy allows it. */
export function canRequest(
  category: MediaStateCategory,
  userRequestStatus: RequestStatusKind | null,
): boolean {
  if (userRequestStatus !== null) return false;
  return MEDIA_STATE_DISPLAY[category].showsRequestCTA;
}
