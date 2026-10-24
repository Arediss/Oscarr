import type { MediaRequest } from '@/types';

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
