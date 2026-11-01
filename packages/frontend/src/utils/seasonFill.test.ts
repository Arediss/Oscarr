import { describe, it, expect } from 'vitest';
import { fillOf, hasRequestableSeasons } from './seasonFill';
import { resolveButtonState, type ButtonStateInputs } from './resolveButtonState';

const season = (n: number, files: number | null, total: number | null) => ({ seasonNumber: n, episodeCount: total, episodeFileCount: files, title: null, posterPath: null, monitored: false });

describe('fillOf', () => {
  it('is full when every native episode is on disk', () => expect(fillOf(season(1, 10, 10))).toBe('full'));
  it('is partial when some are missing', () => expect(fillOf(season(1, 4, 10))).toBe('partial'));
  it('is empty when none are there', () => expect(fillOf(season(1, 0, 10))).toBe('empty'));
  it('is unknown when file status is unavailable', () => expect(fillOf(season(1, null, 10))).toBe('unknown'));
  it('never borrows another provider total when the native total is unknown', () => expect(fillOf(season(1, 8, null))).toBe('partial'));
});

describe('hasRequestableSeasons', () => {
  it('does not offer already-monitored Apothecary Diaries season three while future episodes are unaired', () => {
    expect(hasRequestableSeasons([
      { ...season(1, 24, 24), monitored: true },
      { ...season(2, 24, 24), monitored: true },
      { ...season(3, 5, 24), monitored: true },
    ])).toBe(false);
  });
  it('still offers an incomplete season that the service is not monitoring', () => {
    expect(hasRequestableSeasons([{ ...season(3, 5, 24), monitored: false }])).toBe(true);
  });
  it('is true when a later native season is empty', () => expect(hasRequestableSeasons([season(1, 10, 10), season(2, 0, 10)])).toBe(true));
  it('is false once every native season is complete', () => expect(hasRequestableSeasons([season(1, 10, 10), season(2, 10, 10)])).toBe(false));
  it('is true when a season is only half there', () => expect(hasRequestableSeasons([season(1, 5, 10)])).toBe(true));
  it('ignores the specials bucket', () => expect(hasRequestableSeasons([season(0, 0, 5), season(1, 10, 10)])).toBe(false));
  it('is true when native file status is unknown', () => expect(hasRequestableSeasons([season(1, null, 10)])).toBe(true));
});
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

describe('resolveButtonState', () => {
  it('offers the remaining seasons instead of declaring the series available', () => {
    expect(resolveButtonState(inputs({ isAvailable: true, hasRequestableSeasons: true })))
      .toBe('can_request_seasons');
  });

  it('still says available when nothing is left to ask for', () => {
    expect(resolveButtonState(inputs({ isAvailable: true }))).toBe('available');
  });

  it('does not offer more seasons while the user already has a request in flight', () => {
    expect(resolveButtonState(inputs({ isAvailable: true, hasRequestableSeasons: true, userHasRequest: true })))
      .toBe('available');
  });

  it('leaves every other transition untouched', () => {
    expect(resolveButtonState(inputs())).toBe('can_request');
    expect(resolveButtonState(inputs({ isDownloading: true }))).toBe('downloading');
    expect(resolveButtonState(inputs({ isUpcoming: true }))).toBe('upcoming');
    expect(resolveButtonState(inputs({ isSearching: true }))).toBe('searching');
    expect(resolveButtonState(inputs({ blacklisted: true }))).toBe('blocked');
    expect(resolveButtonState(inputs({ userHasRequest: true }))).toBe('already_requested');
    expect(resolveButtonState(inputs({ isPartiallyAvailable: true }))).toBe('partially_available');
  });
});
