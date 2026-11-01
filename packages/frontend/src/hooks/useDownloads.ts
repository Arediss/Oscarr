import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { activeDownloadKeys, downloadSubscriptionKey } from '@/utils/downloadCompletion';

export interface DownloadItem {
  tmdbId: number;
  mediaType: string;
  serviceId?: number;
  seasonNumbering?: string;
  title: string;
  progress: number;
  timeLeft: string;
  estimatedCompletion: string;
  size: number;
  sizeLeft: number;
  status: string;
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}

let cachedDownloads: DownloadItem[] = [];
let previousKeys = new Set<string>();
let lastFetch = 0;
const listeners = new Set<() => void>();
const completionCallbacks = new Map<string, Set<() => void>>();

async function fetchDownloads() {
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const { data } = await api.get('/services/downloads');
    const nextKeys = activeDownloadKeys(data as DownloadItem[]);

    // Detect completed downloads: was in queue before, no longer in queue
    for (const key of previousKeys) {
      if (!nextKeys.has(key)) {
        const cbs = completionCallbacks.get(key);
        if (cbs) cbs.forEach((cb) => cb());
      }
    }

    previousKeys = nextKeys;
    cachedDownloads = data;
    lastFetch = Date.now();
    listeners.forEach((cb) => cb());
  } catch (err) { console.warn("[useDownloads] poll failed", err); }
}

// Shared polling: starts when first listener subscribes, stops when last unsubscribes
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    if (Date.now() - lastFetch > 5000) fetchDownloads();
    interval = setInterval(fetchDownloads, 10000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

export function useDownloads() {
  const [, setTick] = useState(0);

  useEffect(() => {
    return subscribe(() => setTick((t) => t + 1));
  }, []);

  return cachedDownloads;
}

export function useDownloadForMedia(tmdbId: number | undefined, mediaType?: string, serviceId?: number) {
  const downloads = useDownloads();
  if (!tmdbId) return null;
  return downloads.find((d) => d.tmdbId === tmdbId && (!mediaType || d.mediaType === mediaType)
    && (serviceId === undefined || d.serviceId === serviceId)) ?? null;
}

/** Register a callback that fires when a specific tmdbId leaves the download queue */
export function useOnDownloadComplete(tmdbId: number | undefined, callback: () => void, mediaType?: string, serviceId?: number) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!tmdbId) return;
    const key = downloadSubscriptionKey(tmdbId, mediaType, serviceId);
    const stableCb = () => cbRef.current();
    let cbs = completionCallbacks.get(key);
    if (!cbs) {
      cbs = new Set();
      completionCallbacks.set(key, cbs);
    }
    cbs.add(stableCb);
    return () => {
      cbs.delete(stableCb);
      if (cbs.size === 0) completionCallbacks.delete(key);
    };
  }, [tmdbId, mediaType, serviceId]);
}
