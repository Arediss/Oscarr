import { describe, expect, it } from 'vitest';
import { episodeState, nextEpisodeDate, episodeTitle } from './episodeStatus';

const now = Date.parse('2026-10-18T12:00:00Z');
const episode = (airDateUtc: string | null, hasFile = false) => ({ airDateUtc, hasFile });

describe('Sonarr episode states', () => {
  it('never calls an undated or invalid date missing', () => {
    for (const date of [null, '', 'TBA', 'invalid']) expect(episodeState(episode(date), now)).toBe('undated');
  });
  it('uses the UTC instant, including the exact air time', () => {
    expect(episodeState(episode('2026-10-18T15:00:01+03:00'), now)).toBe('upcoming');
    expect(episodeState(episode('2026-10-18T15:00:00+03:00'), now)).toBe('missing');
  });
  it('prioritizes a file and then an actual queue entry over the date', () => {
    expect(episodeState(episode(null, true), now, true)).toBe('available');
    expect(episodeState(episode(null), now, true)).toBe('downloading');
  });
  it('finds the earliest future known date without assuming episode order', () => {
    expect(nextEpisodeDate([episode(null), episode('2026-11-02T20:00:00Z'), episode('2026-10-20T20:00:00Z'), episode('2026-10-01T20:00:00Z')], now)).toBe('2026-10-20T20:00:00Z');
    expect(nextEpisodeDate([episode(null), episode('TBA')], now)).toBeNull();
  });
  it('hides placeholder titles independently from dates', () => {
    expect(episodeTitle(' TBA ', 'Épisode 6')).toBe('Épisode 6');
    expect(episodeTitle('A new adventure', 'Épisode 6')).toBe('A new adventure');
  });
});
