import { describe, expect, it } from 'vitest';
import { mergeSeasonEpisodes } from './seasonEpisodes';
import { episodeState, type EpisodeInfo } from './episodeStatus';

const metadata = [
  { episode_number: 2, name: 'Le retour', air_date: '2026-10-20' },
  { episode_number: 1, name: 'Le départ', air_date: '2026-10-01' },
];
const now = Date.parse('2026-10-24T12:00:00Z');
const stored: EpisodeInfo = { episodeNumber: 1, title: 'Pilot', airDateUtc: '2026-10-01T20:00:00Z', hasFile: true, monitored: true, quality: '1080p', size: 42 };

describe('season metadata and library availability', () => {
  it('shows ordered TMDB episodes before the series is added to Sonarr', () => {
    const episodes = mergeSeasonEpisodes(metadata, null);
    expect(episodes.map(ep => ep.title)).toEqual(['Le départ', 'Le retour']);
    expect(episodes.every(ep => ep.hasFile === null)).toBe(true);
    expect(episodeState(episodes[0], now)).toBe('unknown');
  });
  it('overlays only matching Sonarr files, keeping localized metadata and exact air time', () => {
    const episodes = mergeSeasonEpisodes(metadata, [stored]);
    expect(episodes[0]).toMatchObject({ title: 'Le départ', hasFile: true, quality: '1080p', airDateUtc: stored.airDateUtc });
    expect(episodes[1].hasFile).toBeNull();
    expect(episodeState(episodes[1], now)).toBe('unknown');
  });
  it('does not invent missing episodes when Sonarr is empty or unavailable', () => {
    for (const library of [[], null]) expect(episodeState(mergeSeasonEpisodes(metadata, library)[0], now)).toBe('unknown');
    expect(episodeState(mergeSeasonEpisodes(metadata, [{ ...stored, hasFile: false }])[0], now)).toBe('missing');
  });
  it('can still show Sonarr episodes when metadata fails, without dropping extra episodes', () => {
    expect(mergeSeasonEpisodes(null, [stored])).toEqual([stored]);
    expect(mergeSeasonEpisodes([], [stored])).toEqual([stored]);
  });
  it('keeps upcoming and undated episodes meaningful without Sonarr', () => {
    expect(episodeState({ hasFile: null, airDateUtc: '2026-12-01' }, now)).toBe('upcoming');
    expect(episodeState({ hasFile: null, airDateUtc: null }, now)).toBe('undated');
    expect(episodeState({ hasFile: null, airDateUtc: '2026-10-01' }, now, true)).toBe('downloading');
  });
});
