import type { MediaStateCategory } from '@oscarr/shared';

export interface UserProviderInfo {
  provider: string;
  username?: string | null;
  email?: string | null;
  /** Avatar URL fetched from this provider — used by the avatar source picker. */
  avatar?: string | null;
}

export interface User {
  id: number;
  email: string;
  displayName: string | null;
  avatar: string | null;
  /** Which linked provider supplies the avatar. `null` = legacy/auto, `"none"` = initials fallback,
   *  `"dicebear"` = self-generated SVG, otherwise a provider id (matches an entry in `providers[].provider`). */
  avatarSource?: string | null;
  /** JSON-encoded `{ style, seed }` for the dicebear editor — null when avatarSource isn't dicebear. */
  avatarConfig?: string | null;
  /** Role name — 'admin'/'user' are the built-in system roles; admins can create custom roles at runtime. */
  role: string;
  disabled?: boolean;
  providers?: UserProviderInfo[];
  createdAt?: string;
}

export interface AdminUser extends User {
  requestCount?: number;
}

export interface AuthProviderConfig {
  id: string;
  label: string;
  type: 'oauth' | 'credentials';
  /** True when the provider will auto-create new Oscarr users on first login / registration. */
  allowSignup?: boolean;
}

export interface RootFolder {
  id: number;
  path: string;
  freeSpace: number;
}

export interface QualityProfile {
  id: number;
  name: string;
}

// TMDB response types moved to @oscarr/shared. Re-exported here so existing
// `import { TmdbMedia } from '@/types'` sites keep working; new code should import directly
// from '@oscarr/shared' where possible.
export type {
  TmdbCollection, TmdbCollectionRef, TmdbMovie, TmdbTv, TmdbMedia, TmdbSeason, TmdbCast,
  TmdbCrew, TmdbPerson, TmdbVideo,
} from '@oscarr/shared';

export interface Media {
  id: number;
  tmdbId: number;
  tvdbId: number | null;
  mediaType: 'movie' | 'tv';
  title: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  genres: string | null;
  statusCategory: MediaStateCategory;
  radarrId: number | null;
  sonarrId: number | null;
  contentRating: string | null;
  requests?: MediaRequest[];
  seasons?: Season[];
}

export interface Season {
  id: number;
  mediaId: number;
  seasonNumber: number;
  episodeCount: number;
  statusCategory: MediaStateCategory;
}

export interface MediaRequest {
  id: number;
  mediaId: number;
  userId: number;
  status: 'pending' | 'approved' | 'declined' | 'processing' | 'available' | 'failed';
  mediaType: 'movie' | 'tv';
  seasons: string | null;
  rootFolder: string | null;
  qualityOptionId: number | null;
  approvedById: number | null;
  createdAt: string;
  updatedAt: string;
  media?: Media;
  user?: Pick<User, 'id' | 'displayName' | 'avatar'>;
  approvedBy?: Pick<User, 'id' | 'displayName'>;
  qualityOption?: { id: number; label: string } | null;
}

export interface QueueItem {
  movieId?: number;
  seriesId?: number;
  title: string;
  status: string;
  size: number;
  sizeLeft: number;
  timeLeft: string;
  estimatedCompletion: string;
  progress: number;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
    title: string;
  };
}
