import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import type { TmdbMedia } from '@/types';
import type { MediaStateCategory, RequestStatus } from '@oscarr/shared';
import { MediaStatusCache, type MediaStatus } from '@/utils/mediaStatusCache';

type StatusMap = Record<string, MediaStatus>;

// Global cache with TTL (30s) to allow re-fetching after changes
const globalCache = new MediaStatusCache();
const BATCH_SIZE = 50;

let pendingIds: { tmdbId: number; mediaType: string }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listeners: (() => void)[] = [];

function isCacheValid(key: string): boolean {
  return globalCache.isValid(key);
}

async function sendBatch(items: { tmdbId: number; mediaType: string }[]) {
  const versions = new Map(items.map(item => {
    const key = `${item.mediaType}:${item.tmdbId}`;
    return [key, globalCache.version(key)];
  }));
  const { data } = await api.post('/media/batch-status', { ids: items });
  // A successful lookup omits untracked titles; failed lookups remain unknown.
  for (const item of items) {
    const key = `${item.mediaType}:${item.tmdbId}`;
    globalCache.setIfUnchanged(key, versions.get(key)!, data[key] ?? { statusCategory: 'UNAVAILABLE' });
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    const batch = [...pendingIds];
    pendingIds = [];
    flushTimer = null;

    if (batch.length === 0) return;

    // Deduplicate
    const unique = batch.filter((item, i, arr) =>
      arr.findIndex((b) => b.tmdbId === item.tmdbId && b.mediaType === item.mediaType) === i
    );

    // Only request ones we don't have cached or whose cache expired
    const uncached = unique.filter((item) => !isCacheValid(`${item.mediaType}:${item.tmdbId}`));
    if (uncached.length === 0) return;

    try {
      // Send in chunks of BATCH_SIZE to respect server limit
      for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
        await sendBatch(uncached.slice(i, i + BATCH_SIZE));
      }
      listeners.forEach((cb) => cb());
    } catch {
      // Silently fail
    }
  }, 150);
}

/** Invalidate cache for a specific media, forcing re-fetch on next render */
export function invalidateMediaStatus(tmdbId: number, mediaType: string) {
  const key = `${mediaType}:${tmdbId}`;
  globalCache.invalidate(key);
  pendingIds.push({ tmdbId, mediaType });
  scheduleFlush();
  listeners.forEach(cb => cb());
}

/** Update cache for a specific media with a known status (avoids stale data on back navigation).
 *  requestStatus is tri-state: a value sets it, `null` clears it (caller KNOWS there is no active
 *  request — e.g. it was declined), `undefined` keeps the cached one (caller doesn't know). The
 *  keep-on-undefined default avoids blanking the badge, but callers that hold the fresh request
 *  state must pass it explicitly or a decline keeps showing as "Requested" until the TTL expires. */
export function updateMediaStatusCache(tmdbId: number, mediaType: string, statusCategory: MediaStateCategory, requestStatus?: RequestStatus | null, hasFreeQualityOption?: boolean) {
  const key = `${mediaType}:${tmdbId}`;
  const next = requestStatus === undefined ? globalCache.get(key)?.requestStatus : requestStatus ?? undefined;
  globalCache.patch(key, { statusCategory, requestStatus: next, ...(hasFreeQualityOption === undefined ? {} : { hasFreeQualityOption }) });
  listeners.forEach((cb) => cb());
}

/** Invalidate all cached statuses */
export function invalidateAllMediaStatuses() {
  globalCache.clear();
  listeners.forEach(cb => cb());
}

export function useMediaStatus(media: TmdbMedia[]): StatusMap {
  const [statuses, setStatuses] = useState<StatusMap>({});
  const idRef = useRef(0);

  useEffect(() => {
    const currentId = ++idRef.current;

    const items = media
      .filter((m) => m.id && (m.media_type || m.title || m.name))
      .map((m) => ({
        tmdbId: m.id,
        mediaType: m.media_type || (m.title ? 'movie' : 'tv'),
      }));

    if (items.length === 0) { setStatuses({}); return; }

    // Add to pending batch
    pendingIds.push(...items);
    scheduleFlush();

    // Build initial state from cache
    const fromCache: StatusMap = {};
    for (const item of items) {
      const key = `${item.mediaType}:${item.tmdbId}`;
      const cached = globalCache.get(key);
      if (cached) fromCache[key] = cached;
    }
    setStatuses(fromCache);

    // Listen for updates
    const listener = () => {
      if (currentId !== idRef.current) return;
      const updated: StatusMap = {};
      for (const item of items) {
        const key = `${item.mediaType}:${item.tmdbId}`;
        const cached = globalCache.get(key);
        if (cached) updated[key] = cached;
      }
      setStatuses(updated);
    };

    listeners.push(listener);
    const timer = setInterval(() => {
      if (document.hidden) return;
      pendingIds.push(...items);
      scheduleFlush();
    }, 30000);
    return () => {
      clearInterval(timer);
      listeners = listeners.filter((l) => l !== listener);
    };
  }, [media]);

  return statuses;
}

export function getStatusForMedia(
  statuses: StatusMap,
  tmdbId: number,
  mediaType: string
): MediaStatus | null {
  return statuses[`${mediaType}:${tmdbId}`] || null;
}
