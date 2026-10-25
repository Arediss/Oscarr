import type { MediaRequest } from '@/types';
import { parseRequestSeasons } from './requestSeasons';

/** Sort labels only: the original order still identifies the latest request on the card. */
export function sortRequestsBySeason(requests: MediaRequest[]): MediaRequest[] {
  const firstSeason = (request: MediaRequest) => {
    const seasons = request.mediaType === 'tv' ? parseRequestSeasons(request.seasons) : null;
    return Array.isArray(seasons) ? seasons[0] : Infinity;
  };
  return [...requests].sort((a, b) => {
    const aSeason = firstSeason(a);
    const bSeason = firstSeason(b);
    return aSeason === bSeason ? 0 : aSeason - bSeason;
  });
}

export function groupRequests(requests: MediaRequest[]): MediaRequest[][] {
  const groups = new Map<string, Map<number, MediaRequest>>();
  for (const request of requests) {
    const key = `${request.mediaId}:${request.userId}`;
    const group = groups.get(key) ?? new Map<number, MediaRequest>();
    group.set(request.id, request);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => [...group.values()]);
}
