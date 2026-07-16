import type { MediaRequest, User, UserProvider } from '@prisma/client';
import { buildSeerrMedia, type SeerrMediaInfo } from './media.js';
import { buildSeerrUser, type SeerrUser } from './user.js';
import { mapRequestStatus } from './statusMap.js';
import type { SeerrMediaWithSeasons } from '../shared.js';

export interface SeerrSeasonRequest {
  id: number;
  seasonNumber: number;
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface SeerrMediaRequest {
  id: number;
  status: number;
  createdAt: string;
  updatedAt: string;
  type: 'movie' | 'tv';
  is4k: boolean;
  serverId: number | null;
  profileId: number | null;
  rootFolder: string | null;
  languageProfileId: number | null;
  tags: number[];
  isAutoRequest: boolean;
  media: SeerrMediaInfo;
  seasons: SeerrSeasonRequest[];
  modifiedBy: SeerrUser | null;
  requestedBy: SeerrUser;
  seasonCount: number;
}

interface AdaptInput {
  request: MediaRequest & {
    media: SeerrMediaWithSeasons;
    user: User & { providers: UserProvider[] };
    approvedBy: (User & { providers: UserProvider[] }) | null;
  };
  /** requestCount cached per user so we don't issue a count query inside a hot loop. */
  requestCountByUserId: Map<number, number>;
}

export function buildSeerrRequest({ request, requestCountByUserId }: AdaptInput): SeerrMediaRequest {
  const seasons = parseSeasons(request.seasons);

  return {
    id: request.id,
    status: mapRequestStatus(request.status),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    type: request.mediaType as 'movie' | 'tv',
    is4k: false,
    serverId: null,
    profileId: request.qualityOptionId ?? null,
    rootFolder: request.rootFolder ?? null,
    languageProfileId: null,
    tags: [],
    isAutoRequest: false,
    media: buildSeerrMedia(request.media),
    seasons: seasons.map((seasonNumber) => ({
      id: seasonNumber,
      seasonNumber,
      status: mapRequestStatus(request.status),
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    })),
    modifiedBy: request.approvedBy
      ? buildSeerrUser({ user: request.approvedBy, requestCount: requestCountByUserId.get(request.approvedBy.id) ?? 0 })
      : null,
    requestedBy: buildSeerrUser({
      user: request.user,
      requestCount: requestCountByUserId.get(request.user.id) ?? 0,
    }),
    seasonCount: seasons.length,
  };
}

function parseSeasons(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n));
  } catch { return []; }
}
