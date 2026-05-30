import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import type { TmdbMedia } from '@/types';
import type { MediaStateCategory, RequestStatus } from '@oscarr/shared';

interface MediaStatus {
  statusCategory: MediaStateCategory;
  requestStatus?: RequestStatus;
}

type StatusMap = Record<string, MediaStatus>;

// Global cache with TTL (30s) to allow re-fetching after changes
const globalCache: StatusMap = {};
const cacheTimes: Record<string, number> = {};
const CACHE_TTL = 30_000;
const BATCH_SIZE = 50;

let pendingIds: { tmdbId: number; mediaType: string }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listeners: (() => void)[] = [];

function isCacheValid(key: string): boolean {
  return key in cacheTimes && Date.now() - cacheTimes[key] < CACHE_TTL;
}

async function sendBatch(items: { tmdbId: number; mediaType: string }[]) {
  const { data } = await api.post('/media/batch-status', { ids: items });
  const now = Date.now();
  Object.assign(globalCache, data);
  for (const key of Object.keys(data)) {
    cacheTimes[key] = now;
  }
  // Mark items not returned by the server as "unknown"
  for (const item of items) {
    const key = `${item.mediaType}:${item.tmdbId}`;
    if (!(key in data)) {
      globalCache[key] = { statusCategory: 'UNAVAILABLE' };
      cacheTimes[key] = now;
    }
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
  delete cacheTimes[key];
  delete globalCache[key];
}

/** Update cache for a specific media with a known status (avoids stale data on back navigation) */
export function updateMediaStatusCache(tmdbId: number, mediaType: string, statusCategory: MediaStateCategory, requestStatus?: RequestStatus) {
  const key = `${mediaType}:${tmdbId}`;
  globalCache[key] = { statusCategory, requestStatus };
  cacheTimes[key] = Date.now();
  listeners.forEach((cb) => cb());
}

/** Invalidate all cached statuses */
export function invalidateAllMediaStatuses() {
  for (const key of Object.keys(cacheTimes)) {
    delete cacheTimes[key];
  }
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

    if (items.length === 0) return;

    // Add to pending batch
    pendingIds.push(...items);
    scheduleFlush();

    // Build initial state from cache
    const fromCache: StatusMap = {};
    for (const item of items) {
      const key = `${item.mediaType}:${item.tmdbId}`;
      if (key in globalCache) {
        fromCache[key] = globalCache[key];
      }
    }
    if (Object.keys(fromCache).length > 0) {
      setStatuses(fromCache);
    }

    // Listen for updates
    const listener = () => {
      if (currentId !== idRef.current) return;
      const updated: StatusMap = {};
      for (const item of items) {
        const key = `${item.mediaType}:${item.tmdbId}`;
        if (key in globalCache) {
          updated[key] = globalCache[key];
        }
      }
      setStatuses(updated);
    };

    listeners.push(listener);
    return () => {
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
