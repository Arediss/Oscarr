import type { Media } from '@prisma/client';
import { mapMediaStatus } from './statusMap.js';

/**
 * Subset of Overseerr's `Media` entity that Seerr clients actually read. We omit fields tied to
 * Overseerr internals (4k tracking, Plex/Jellyfin ratingKeys, watchlist, language profile) —
 * they default to null/empty and clients fall back gracefully.
 */
export interface SeerrMediaInfo {
  id: number;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  tvdbId: number | null;
  imdbId: string | null;
  status: number;
  status4k: number;
  createdAt: string;
  updatedAt: string;
  lastSeasonChange: string;
  mediaAddedAt: string | null;
  serviceId: number | null;
  serviceId4k: number | null;
  externalServiceId: number | null;
  externalServiceId4k: number | null;
  externalServiceSlug: string | null;
  externalServiceSlug4k: string | null;
  ratingKey: string | null;
  ratingKey4k: string | null;
  jellyfinMediaId: string | null;
  jellyfinMediaId4k: string | null;
  iOSPlexUrl: string | null;
  iOSPlexUrl4k: string | null;
  plexUrl: string | null;
  plexUrl4k: string | null;
  serviceUrl: string | null;
  serviceUrl4k: string | null;
}

export function buildSeerrMedia(media: Media): SeerrMediaInfo {
  // *arr internal id (Radarr movie.id / Sonarr series.id) — exposed as Overseerr's
  // externalServiceId so dashboards can deep-link into the *arr UI.
  const externalServiceId = media.mediaType === 'movie' ? media.radarrId : media.sonarrId;

  return {
    id: media.id,
    mediaType: media.mediaType as 'movie' | 'tv',
    tmdbId: media.tmdbId,
    tvdbId: media.tvdbId,
    imdbId: null,
    status: mapMediaStatus(media.statusCategory),
    // Oscarr doesn't track a separate 4k pipeline; report UNKNOWN so 4k-aware UIs hide that column.
    status4k: 1,
    createdAt: media.createdAt.toISOString(),
    updatedAt: media.updatedAt.toISOString(),
    lastSeasonChange: media.updatedAt.toISOString(),
    mediaAddedAt: media.availableAt?.toISOString() ?? null,
    serviceId: null,
    serviceId4k: null,
    externalServiceId,
    externalServiceId4k: null,
    externalServiceSlug: null,
    externalServiceSlug4k: null,
    ratingKey: null,
    ratingKey4k: null,
    jellyfinMediaId: null,
    jellyfinMediaId4k: null,
    iOSPlexUrl: null,
    iOSPlexUrl4k: null,
    plexUrl: null,
    plexUrl4k: null,
    serviceUrl: null,
    serviceUrl4k: null,
  };
}
