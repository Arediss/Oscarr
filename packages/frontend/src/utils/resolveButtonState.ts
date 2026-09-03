export type ButtonState =
  | 'available'
  | 'can_request_seasons'
  | 'can_request_quality'
  | 'downloading'
  | 'upcoming'
  | 'searching'
  | 'already_requested'
  | 'partially_available'
  | 'partially_searching'
  | 'partially_error'
  | 'blocked'
  | 'can_request';

export interface ButtonStateInputs {
  isAvailable: boolean;
  isPartiallyAvailable: boolean;
  isDownloading: boolean;
  isUpcoming: boolean;
  isSearching: boolean;
  userHasRequest: boolean;
  canRequestNewQuality: boolean;
  /** Series only: at least one season the library does not hold in full. */
  hasRequestableSeasons: boolean;
  blacklisted: boolean;
  searchMissingState: 'idle' | 'searching' | 'error';
}

export function resolveButtonState(inputs: ButtonStateInputs): ButtonState {
  const {
    isAvailable, isPartiallyAvailable, isDownloading, isUpcoming,
    isSearching, userHasRequest, canRequestNewQuality, hasRequestableSeasons, blacklisted,
    searchMissingState,
  } = inputs;

  // Checked before `available`: Sonarr reports percentOfEpisodes against *monitored* episodes, so
  // a series with one complete season and two unmonitored ones comes back 100% and used to end
  // here with no way to ask for the rest.
  if (isAvailable && hasRequestableSeasons && !userHasRequest) return 'can_request_seasons';
  if (isAvailable && !canRequestNewQuality) return 'available';
  if (isAvailable && canRequestNewQuality) return 'can_request_quality';
  // A free quality option now outranks the transient states, where it used to be read after them.
  //
  // That order was the bug in discussion #228: the moment one person asked for a title, everyone
  // else saw "upcoming" or "downloading" and no button, however many options were untaken. Those
  // three states describe what is happening to *a* request, not to the title, and they said
  // nothing about whether another option was still free.
  //
  // Only reachable when an option really is untaken: `canRequestNewQuality` is computed from the
  // set of options already requested, so a title being fetched in the only configured option
  // still reads as `downloading`.
  if (canRequestNewQuality) return 'can_request_quality';
  if (isDownloading) return 'downloading';
  if (isUpcoming) return 'upcoming';
  if (isSearching) return 'searching';
  if (userHasRequest && !isPartiallyAvailable) return 'already_requested';
  if (isPartiallyAvailable) {
    if (searchMissingState === 'searching') return 'partially_searching';
    if (searchMissingState === 'error') return 'partially_error';
    return 'partially_available';
  }
  if (blacklisted) return 'blocked';
  return 'can_request';
}
