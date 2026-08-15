import { ACTIVE_REQUEST_STATUSES } from '@oscarr/shared';
import { resolveButtonState, type ButtonState, type ButtonStateInputs } from '@/utils/resolveButtonState';

interface RequestLike {
  status: string;
  qualityOptionId?: number | null;
  user?: { id: number } | null;
}

interface DbMediaLike {
  statusCategory?: string;
  requests?: RequestLike[];
}

interface Params {
  dbMedia: DbMediaLike | null | undefined;
  type: 'movie' | 'tv';
  inLibrary: boolean;
  isDownloading: boolean;
  blacklisted: boolean;
  activeQualityOptionIds: number[];
  selectedQuality: number | null;
  searchMissingState: ButtonStateInputs['searchMissingState'];
  currentUserId: number | undefined;
}

export interface MediaAvailability {
  isAvailable: boolean;
  /** A quality already requested, or already satisfied by the *arr profile, cannot be asked for. */
  takenQualityIds: Set<number>;
  userHasRequest: boolean;
  buttonState: ButtonState;
}

/**
 * Turns the raw media row into the handful of booleans the page actually renders against.
 *
 * Lives outside the component because every one of these is a small rule about what a user is
 * allowed to do next, and reading them interleaved with 400 lines of JSX is how the page became
 * hard to reason about in the first place.
 */
export function useMediaAvailability({
  dbMedia, type, inLibrary, isDownloading, blacklisted,
  activeQualityOptionIds, selectedQuality, searchMissingState, currentUserId,
}: Params): MediaAvailability {
  const category = dbMedia?.statusCategory;
  const isAvailable = category === 'AVAILABLE' || inLibrary;

  const activeRequests = dbMedia?.requests?.filter(
    (r) => (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(r.status),
  ) ?? [];

  const takenQualityIds = new Set<number>([
    ...activeRequests.map((r) => r.qualityOptionId).filter((q): q is number => !!q),
    ...activeQualityOptionIds,
  ]);

  const userHasRequest = activeRequests.some((r) => r.user?.id === currentUserId);

  return {
    isAvailable,
    takenQualityIds,
    userHasRequest,
    buttonState: resolveButtonState({
      isAvailable,
      // Only meaningful for a series: a movie is one file, it is never half there.
      isPartiallyAvailable: !isAvailable && category === 'PROCESSING' && type === 'tv',
      isDownloading,
      isUpcoming: category === 'UPCOMING',
      isSearching: category === 'SEARCHING',
      userHasRequest,
      canRequestNewQuality: selectedQuality != null && !takenQualityIds.has(selectedQuality),
      blacklisted,
      searchMissingState,
    }),
  };
}
