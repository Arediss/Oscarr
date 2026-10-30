import { describe, expect, it } from 'vitest';
import { selectSeasonEpisodes } from './seasonEpisodes';
import { episodeState, type EpisodeInfo } from './episodeStatus';

const metadata = [
  { episode_number: 2, name: 'Le retour', air_date: '2026-10-20' },
  { episode_number: 1, name: 'Le départ', air_date: '2026-10-01' },
];
const now = Date.parse('2026-10-24T12:00:00Z');
const stored: EpisodeInfo = { episodeNumber: 1, title: 'Pilot', airDateUtc: '2026-10-01T20:00:00Z', hasFile: true, monitored: true, quality: '1080p', size: 42 };

describe('season metadata and library availability', () => {
  it('shows ordered TMDB episodes before the series is added to Sonarr', () => {
    const episodes = selectSeasonEpisodes(metadata, null);
    expect(episodes.map(ep => ep.title)).toEqual(['Le départ', 'Le retour']);
    expect(episodes.every(ep => ep.hasFile === null)).toBe(true);
    expect(episodeState(episodes[0], now)).toBe('unknown');
  });
  it('uses native episode identity without replacing its title with the same TMDB number', () => {
    const episodes = selectSeasonEpisodes(metadata, [stored]);
    expect(episodes).toEqual([stored]);
  });
  it('does not invent missing episodes when Sonarr is empty or unavailable', () => {
    expect(selectSeasonEpisodes(metadata, [])).toEqual([]);
    expect(episodeState(selectSeasonEpisodes(metadata, null)[0], now)).toBe('unknown');
    expect(episodeState(selectSeasonEpisodes(metadata, [{ ...stored, hasFile: false }])[0], now)).toBe('missing');
  });
  it('can still show Sonarr episodes when metadata fails, without dropping extra episodes', () => {
    expect(selectSeasonEpisodes(null, [stored])).toEqual([stored]);
    expect(selectSeasonEpisodes([], [stored])).toEqual([stored]);
  });
  it('keeps upcoming and undated episodes meaningful without Sonarr', () => {
    expect(episodeState({ hasFile: null, airDateUtc: '2026-12-01' }, now)).toBe('upcoming');
    expect(episodeState({ hasFile: null, airDateUtc: null }, now)).toBe('undated');
    expect(episodeState({ hasFile: null, airDateUtc: '2026-10-01' }, now, true)).toBe('downloading');
  });
});
