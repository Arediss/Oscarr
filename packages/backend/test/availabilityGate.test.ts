import { describe, it, expect } from 'vitest';
import { buildAvailability, gateCategory, sourceNeedsLibrary, NO_LIBRARY_GATE, type LibraryGate } from '../src/services/availability.js';
import { MEDIA_STATE_CATEGORIES, MEDIA_STATE_DISPLAY } from '@oscarr/shared';
import { mapMediaStatus, SEERR_MEDIA_STATUS } from '../src/seerr/adapters/statusMap.js';

const CONFIRMED = new Date('2026-08-08T10:00:00Z');
/** Source ids, not booleans: 'radarr'/'sonarr' mean "trust the downloader", 'plex' means
 *  "wait for the library". */
const gate = (movie: string, tv: string): LibraryGate => ({ movie, tv });
const noBlacklist = new Set<string>();

const media = (over: Partial<{ mediaType: string; statusCategory: string; libraryConfirmedAt: Date | null }> = {}) => ({
  tmdbId: 1,
  mediaType: over.mediaType ?? 'movie',
  statusCategory: over.statusCategory ?? 'AVAILABLE',
  libraryConfirmedAt: over.libraryConfirmedAt ?? null,
});

describe('gateCategory', () => {
  it('leaves everything alone when the *arr is the source', () => {
    for (const category of MEDIA_STATE_CATEGORIES) {
      expect(gateCategory(category, 'movie', null, NO_LIBRARY_GATE)).toBe(category);
    }
  });

  it('downgrades an unconfirmed AVAILABLE to IMPORTED', () => {
    expect(gateCategory('AVAILABLE', 'movie', null, gate('plex', 'sonarr'))).toBe('IMPORTED');
  });

  it('keeps AVAILABLE once the library has seen it', () => {
    expect(gateCategory('AVAILABLE', 'movie', CONFIRMED, gate('plex', 'sonarr'))).toBe('AVAILABLE');
  });

  it('applies per media type, not globally', () => {
    // Series read from Plex, movies from Radarr — the whole point of splitting the setting.
    expect(gateCategory('AVAILABLE', 'movie', null, gate('radarr', 'plex'))).toBe('AVAILABLE');
    expect(gateCategory('AVAILABLE', 'tv', null, gate('radarr', 'plex'))).toBe('IMPORTED');
  });

  it('never touches a state that is not AVAILABLE', () => {
    for (const category of ['UNAVAILABLE', 'UPCOMING', 'SEARCHING', 'PROCESSING', 'BLACKLISTED'] as const) {
      expect(gateCategory(category, 'movie', null, gate('plex', 'plex'))).toBe(category);
    }
  });

  it('coerces an unknown stored value rather than trusting it', () => {
    expect(gateCategory('WHATEVER', 'movie', null, gate('plex', 'plex'))).toBe('UNAVAILABLE');
  });
});

describe('sourceNeedsLibrary', () => {
  it('is false for the downloader — asking it again would only confirm itself', () => {
    expect(sourceNeedsLibrary('radarr')).toBe(false);
    expect(sourceNeedsLibrary('sonarr')).toBe(false);
  });

  it('is true for a media server', () => {
    expect(sourceNeedsLibrary('plex')).toBe(true);
  });

  it('is false for an id no connector declares', () => {
    expect(sourceNeedsLibrary('does-not-exist')).toBe(false);
  });
});

describe('buildAvailability', () => {
  it('defaults to no gate, preserving the historical behaviour', () => {
    expect(buildAvailability(media(), null, noBlacklist).statusCategory).toBe('AVAILABLE');
  });

  it('applies the gate when one is passed', () => {
    expect(buildAvailability(media(), null, noBlacklist, gate('plex', 'sonarr')).statusCategory).toBe('IMPORTED');
  });

  it('lets BLACKLISTED win over the gate', () => {
    const blacklisted = new Set(['movie:1']);
    expect(buildAvailability(media(), null, blacklisted, gate('plex', 'plex')).statusCategory).toBe('BLACKLISTED');
  });

  it('carries the request status through untouched', () => {
    const result = buildAvailability(media(), { id: 7, status: 'available' }, noBlacklist, gate('plex', 'plex'));
    expect(result.requestId).toBe(7);
    expect(result.requestStatus).toBe('available');
  });
});

/**
 * The state vocabulary is a contract: plugins switch on it and the Seerr layer maps it to a fixed
 * numeric enum. These guard the contract rather than the feature.
 */
describe('IMPORTED as part of the closed vocabulary', () => {
  it('has a display entry, like every other state', () => {
    for (const category of MEDIA_STATE_CATEGORIES) {
      expect(MEDIA_STATE_DISPLAY[category]).toBeDefined();
    }
  });

  it('does not offer a request CTA — the media is already on its way', () => {
    expect(MEDIA_STATE_DISPLAY.IMPORTED.showsRequestCTA).toBe(false);
  });

  it('maps to PROCESSING for Seerr clients, not UNKNOWN', () => {
    // The default branch would have silently reported UNKNOWN, telling Doplarr the media was
    // never requested when in fact it is downloaded.
    expect(mapMediaStatus('IMPORTED')).toBe(SEERR_MEDIA_STATUS.PROCESSING);
    expect(mapMediaStatus('IMPORTED')).not.toBe(SEERR_MEDIA_STATUS.UNKNOWN);
  });

  it('every category maps to a status Overseerr actually defines', () => {
    const valid = new Set<number>(Object.values(SEERR_MEDIA_STATUS));
    for (const category of MEDIA_STATE_CATEGORIES) {
      expect(valid.has(mapMediaStatus(category))).toBe(true);
    }
  });
});
