import type { MediaStateCategory } from './mediaState.js';
import type { RequestStatusKind } from './requestStatus.js';

export interface CanRequestInput {
  statusCategory: MediaStateCategory;
  userRequestStatus: RequestStatusKind | null;
  showsRequestCTA?: boolean;
}

// Precedence: existing user request blocks → option override → default category policy.
export function canRequest(input: CanRequestInput): boolean {
  if (input.userRequestStatus !== null) return false;
  if (input.showsRequestCTA === false) return false;
  if (input.showsRequestCTA === true) return true;
  switch (input.statusCategory) {
    case 'UNAVAILABLE':       return true;
    case 'PENDING_DECISION':  return false;
    case 'UPCOMING':          return false;
    case 'SEARCHING':         return false;
    case 'PROCESSING':        return false;
    case 'AVAILABLE':         return false;
    case 'BLACKLISTED':       return false;
  }
}
