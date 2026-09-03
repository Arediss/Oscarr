import { describe, it, expect } from 'vitest';
import { canRequest } from '@oscarr/shared';
import { resolveButtonState, type ButtonStateInputs } from './resolveButtonState';

/**
 * The state table, pinned.
 *
 * The order of the checks *is* the behaviour here: nearly every state is reachable from several
 * inputs at once, and which one wins is decided by position in the function rather than by any
 * rule a reader could infer. That makes every precedence below load-bearing, and moving one has to
 * show up as a failing test rather than as a surprise in the interface.
 *
 * Written first against the pre-#228 order, then updated with the fix — the three precedence tests
 * failed exactly where the behaviour was meant to change, which is what they were for.
 *
 * `seasonFill.test.ts` already covers the seasons path; this file owns the quality path, which had
 * no coverage at all.
 */
const inputs = (over: Partial<ButtonStateInputs> = {}): ButtonStateInputs => ({
  isAvailable: false,
  isPartiallyAvailable: false,
  isDownloading: false,
  isUpcoming: false,
  isSearching: false,
  userHasRequest: false,
  canRequestNewQuality: false,
  hasRequestableSeasons: false,
  blacklisted: false,
  searchMissingState: 'idle',
  ...over,
});

describe('resolveButtonState, quality path', () => {
  it('offers another quality on an available title', () => {
    expect(resolveButtonState(inputs({ isAvailable: true, canRequestNewQuality: true })))
      .toBe('can_request_quality');
  });

  it('offers another quality on a title nobody has requested yet', () => {
    expect(resolveButtonState(inputs({ canRequestNewQuality: true }))).toBe('can_request_quality');
  });

  it('prefers the remaining seasons over another quality', () => {
    expect(resolveButtonState(inputs({
      isAvailable: true, hasRequestableSeasons: true, canRequestNewQuality: true,
    }))).toBe('can_request_seasons');
  });

  /**
   * `canRequestNewQuality` is read before `userHasRequest`, so the button is offered to someone who
   * already holds an active request on this title.
   *
   * That used to be a dead end: the backend deduplicated on (media, user, active) and answered 409
   * to the very button the interface had just shown. The check now includes the quality option, so
   * the two agree — this expectation is unchanged, the API simply stopped refusing.
   */
  it('offers another quality even when the user already has a request in flight', () => {
    expect(resolveButtonState(inputs({
      isAvailable: true, canRequestNewQuality: true, userHasRequest: true,
    }))).toBe('can_request_quality');
  });
});

describe('resolveButtonState, the quality path against transient states', () => {
  /**
   * This is the case daviddu26 reported, now the other way round.
   *
   * One person asked for a title and, from that moment, nobody else was offered anything however
   * many options were free: downloading, upcoming and searching were all read before the quality
   * path. They describe what is happening to *a* request, not to the title.
   */
  it.each(['isDownloading', 'isUpcoming', 'isSearching'] as const)(
    'still offers a free quality option while %s',
    (flag) => {
      expect(resolveButtonState(inputs({ [flag]: true, canRequestNewQuality: true })))
        .toBe('can_request_quality');
    },
  );

  it.each([
    ['isDownloading', 'downloading'],
    ['isUpcoming', 'upcoming'],
    ['isSearching', 'searching'],
  ] as const)('reports %s when no option is left to offer', (flag, expected) => {
    expect(resolveButtonState(inputs({ [flag]: true }))).toBe(expected);
  });

  it('ranks downloading above upcoming above searching', () => {
    expect(resolveButtonState(inputs({ isDownloading: true, isUpcoming: true, isSearching: true })))
      .toBe('downloading');
    expect(resolveButtonState(inputs({ isUpcoming: true, isSearching: true }))).toBe('upcoming');
  });
});

describe('resolveButtonState, the remaining table', () => {
  it('reports an available title with nothing left to offer', () => {
    expect(resolveButtonState(inputs({ isAvailable: true }))).toBe('available');
  });

  it('reports the user own request when nothing else applies', () => {
    expect(resolveButtonState(inputs({ userHasRequest: true }))).toBe('already_requested');
  });

  it('prefers the partial states over the user own request', () => {
    expect(resolveButtonState(inputs({ userHasRequest: true, isPartiallyAvailable: true })))
      .toBe('partially_available');
  });

  it.each([
    ['idle', 'partially_available'],
    ['searching', 'partially_searching'],
    ['error', 'partially_error'],
  ] as const)('reflects the missing-search state %s', (state, expected) => {
    expect(resolveButtonState(inputs({ isPartiallyAvailable: true, searchMissingState: state })))
      .toBe(expected);
  });

  /**
   * Blacklisting is read almost last, so a title the user already asked for reads as their own
   * request rather than as blocked. Surprising, and load-bearing: moving the check would change
   * what a blacklisted title looks like to the person who requested it before it was blocked.
   */
  it('blocks only when nothing else claimed the title first', () => {
    expect(resolveButtonState(inputs({ blacklisted: true }))).toBe('blocked');
    expect(resolveButtonState(inputs({ blacklisted: true, userHasRequest: true })))
      .toBe('already_requested');
    expect(resolveButtonState(inputs({ blacklisted: true, canRequestNewQuality: true })))
      .toBe('can_request_quality');
  });

  it('falls through to a plain request', () => {
    expect(resolveButtonState(inputs())).toBe('can_request');
  });
});

/**
 * The grid counterpart of the quality path.
 *
 * A card knows only the category and the current user's own request, so it could never work out
 * that someone else had taken one option and left another free — it simply said no. The batch
 * endpoint now answers that question server-side, since only it has both halves.
 */
describe('canRequest, the grid decision', () => {
  it('offers nothing on a category that forbids it, with no free option', () => {
    expect(canRequest('SEARCHING', null)).toBe(false);
    expect(canRequest('AVAILABLE', null)).toBe(false);
    expect(canRequest('UPCOMING', null)).toBe(false);
  });

  it('offers a request on those same categories once an option is free', () => {
    expect(canRequest('SEARCHING', null, true)).toBe(true);
    expect(canRequest('AVAILABLE', null, true)).toBe(true);
    expect(canRequest('UPCOMING', null, true)).toBe(true);
  });

  // The user's own active request still wins: the grid has no picker to choose another option with.
  it('never offers a second request to someone who already has one', () => {
    expect(canRequest('UNAVAILABLE', 'pending', true)).toBe(false);
    expect(canRequest('SEARCHING', 'approved', true)).toBe(false);
  });

  it('leaves an ordinary requestable title alone', () => {
    expect(canRequest('UNAVAILABLE', null)).toBe(true);
    expect(canRequest('UNAVAILABLE', null, true)).toBe(true);
  });

  it('defaults to the old behaviour when the field is absent', () => {
    expect(canRequest('SEARCHING', null)).toBe(canRequest('SEARCHING', null, false));
  });
});
