import { describe, it, expect } from 'vitest';
import { fillOf, hasRequestableSeasons } from './seasonFill';
import { resolveButtonState, type ButtonStateInputs } from './resolveButtonState';

const season = (n: number, episodes: number) => ({ season_number: n, episode_count: episodes });
const sonarr = (n: number, files: number, total: number) => ({ seasonNumber: n, episodeFileCount: files, totalEpisodeCount: total });

describe('fillOf', () => {
  it('is full when every episode is on disk', () => {
    expect(fillOf(season(1, 10), sonarr(1, 10, 10))).toBe('full');
  });

  it('is partial when some are missing', () => {
    expect(fillOf(season(1, 10), sonarr(1, 4, 10))).toBe('partial');
  });

  it('is empty when none are there', () => {
    expect(fillOf(season(1, 10), sonarr(1, 0, 10))).toBe('empty');
  });

  it('is unknown when Sonarr does not track the series', () => {
    expect(fillOf(season(1, 10), undefined)).toBe('unknown');
  });

  it('falls back to the TMDB count when Sonarr reports no total', () => {
    expect(fillOf(season(1, 8), sonarr(1, 8, 0))).toBe('full');
  });
});

/** The exact case a beta tester hit: one season present, the rest unmonitored, and the page
 *  claimed the whole series was Available with no way to ask for the others. */
describe('hasRequestableSeasons', () => {
  it('is true when a later season is missing entirely', () => {
    const seasons = [season(1, 10), season(2, 10), season(3, 10)];
    const tracked = [sonarr(1, 10, 10), sonarr(2, 0, 10), sonarr(3, 0, 10)];
    expect(hasRequestableSeasons(seasons, tracked)).toBe(true);
  });

  it('is false once every season is complete', () => {
    const seasons = [season(1, 10), season(2, 10)];
    expect(hasRequestableSeasons(seasons, [sonarr(1, 10, 10), sonarr(2, 10, 10)])).toBe(false);
  });

  it('is true when a season is only half there', () => {
    expect(hasRequestableSeasons([season(1, 10)], [sonarr(1, 5, 10)])).toBe(true);
  });

  it('ignores the specials bucket', () => {
    // Season 0 is never requestable on its own, so an empty one must not keep the CTA alive.
    const seasons = [season(0, 5), season(1, 10)];
    expect(hasRequestableSeasons(seasons, [sonarr(0, 0, 5), sonarr(1, 10, 10)])).toBe(false);
  });

  it('is true for a series Sonarr does not know yet', () => {
    expect(hasRequestableSeasons([season(1, 10)], [])).toBe(true);
  });
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
