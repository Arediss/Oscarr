import { canRequest, MEDIA_STATE_DISPLAY } from '@oscarr/shared';
import type { MediaStatus } from './mediaStatusCache';

/** Unknown availability is still loading, never permission to create a request. */
export function cardRequestAction(availability: MediaStatus | null | undefined, enabled: boolean, type: string): 'none' | 'details' | 'request' {
  if (!enabled || !availability || availability.statusCategory === 'BLACKLISTED') return 'none';
  if (!canRequest(availability.statusCategory, availability.requestStatus ?? null, availability.hasFreeQualityOption ?? false)) return 'none';
  if (type === 'tv' || !MEDIA_STATE_DISPLAY[availability.statusCategory].showsRequestCTA) return 'details';
  return 'request';
}
