import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useNsfwFilter } from '@/hooks/useNsfwFilter';
import { useAuth } from '@/context/AuthContext';
import { useDownloadForMedia, useOnDownloadComplete } from '@/hooks/useDownloads';
import { invalidateMediaStatus, updateMediaStatusCache } from '@/hooks/useMediaStatus';
import { type MediaStateCategory, type RequestStatus, toMediaStateCategory } from '@oscarr/shared';
import type { TmdbMedia, Media } from '@/types';
import { useMediaMetadata } from '@/hooks/useMediaMetadata';

interface QualityOption { id: number; label: string; position: number }

/** Session cache — admin edits to quality options require a full reload to pick up. */
let qualityOptionsCache: QualityOption[] | null = null;
let qualityOptionsInFlight: Promise<QualityOption[]> | null = null;
function loadQualityOptions(): Promise<QualityOption[]> {
  if (qualityOptionsCache) return Promise.resolve(qualityOptionsCache);
  if (qualityOptionsInFlight) return qualityOptionsInFlight;
  qualityOptionsInFlight = api.get<QualityOption[]>('/app/quality-options')
    .then(({ data }) => { qualityOptionsCache = data; return data; })
    .catch((err) => {
      // Silent fallback keeps the UI alive (cards still render without quality chips), but a
      // warn lets an admin notice if the endpoint is flat-out broken in their deployment.
      console.warn('[useMediaDetailData] /app/quality-options failed', err);
      return [] as QualityOption[];
    })
    .finally(() => { qualityOptionsInFlight = null; });
  return qualityOptionsInFlight;
}

export function useMediaDetailData(id: string | undefined, type: 'movie' | 'tv') {
  const { addNsfwIds } = useNsfwFilter();
  const { user } = useAuth();
  const { media, loading, catalog, metadata, seasonsLoading, seasonsError, refresh: refreshMetadata } = useMediaMetadata(id, type);
  const [dbMedia, setDbMedia] = useState<Media | null>(null);
  const [inLibrary, setInLibrary] = useState(false);
  const [recommendations, setRecommendations] = useState<TmdbMedia[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>(() => qualityOptionsCache ?? []);
  const [activeQualityOptionIds, setActiveQualityOptionIds] = useState<number[]>([]);
  const [audioLanguages, setAudioLanguages] = useState<string[]>([]);
  const [subtitleLanguages, setSubtitleLanguages] = useState<string[]>([]);
  const [blacklisted, setBlacklisted] = useState<{ blocked: boolean; reason: string | null }>({ blocked: false, reason: null });

  const applyDbData = useCallback((data: Record<string, unknown>) => {
    if (data.id) setDbMedia(data as unknown as Media);
    if (data.inLibrary) setInLibrary(true);
    if (data.statusCategory === 'AVAILABLE' && !data.id) setInLibrary(true);
    if (data.activeQualityOptionIds) setActiveQualityOptionIds(data.activeQualityOptionIds as number[]);
    if (data.audioLanguages) setAudioLanguages(data.audioLanguages as string[]);
    if (data.subtitleLanguages) setSubtitleLanguages(data.subtitleLanguages as string[]);
    if (data.nsfw && id) addNsfwIds([Number.parseInt(id, 10)]);
    // Update global status cache so list pages reflect the latest state on back navigation.
    // The payload carries every request row — derive the viewer's own latest one so a decline is
    // reflected immediately (`null` = known none, clears the stale badge; `undefined` = unknown
    // viewer, keep the cached value rather than wrongly blanking it).
    if (data.statusCategory && id) {
      const tmdbId = Number.parseInt(id, 10);
      if (tmdbId) {
        const requests = (data.requests ?? []) as { userId?: number; status?: string; createdAt?: string }[];
        const ownStatus = user
          ? (requests
              .filter((r) => r.userId === user.id)
              .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0]
              ?.status as RequestStatus | undefined) ?? null
          : undefined;
        updateMediaStatusCache(tmdbId, type, toMediaStateCategory(data.statusCategory), ownStatus, typeof data.hasFreeQualityOption === 'boolean' ? data.hasFreeQualityOption : undefined);
      }
    }
  }, [id, type, addNsfwIds, user]);

  useEffect(() => {
    if (qualityOptionsCache) return;
    loadQualityOptions().then((data) => setQualityOptions(data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLibraryLoading(true);
    // Keep dbMedia until fresh data arrives (prevents button flash)
    setInLibrary(false);
    setActiveQualityOptionIds([]);
    setAudioLanguages([]);
    setSubtitleLanguages([]);

    const dbPromise = api.get(`/media/tmdb/${id}/${type}`)
      .then(({ data }) => { if (!cancelled) { applyDbData(data); if (!data.id) setDbMedia(null); } })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useMediaDetailData] /media/tmdb lookup failed', err);
        setDbMedia(null);
      })
      .finally(() => { if (!cancelled) setLibraryLoading(false); });

    api.get(`/admin/blacklist/check?tmdbId=${id}&mediaType=${type}`)
      .then(({ data }) => { if (!cancelled) setBlacklisted({ blocked: data.blacklisted, reason: data.reason }); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useMediaDetailData] blacklist/check failed', err);
        setBlacklisted({ blocked: false, reason: null });
      });
    api.get(`/tmdb/${type}/${id}/recommendations`).then(({ data }) => {
      if (cancelled) return;
      setRecommendations(data.results?.map((r: TmdbMedia) => ({ ...r, media_type: type })) || []);
      if (data.nsfwTmdbIds?.length) addNsfwIds(data.nsfwTmdbIds);
    }).catch((err) => { if (!cancelled) console.warn('[useMediaDetailData] /recommendations failed', err); });

    void dbPromise;
    return () => { cancelled = true; };
  }, [id, type, applyDbData]);

  const refreshDbData = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/media/tmdb/${id}/${type}`);
      applyDbData(data);
    } catch (err) {
      console.warn('[useMediaDetailData] refreshDbData failed', err);
    }
  }, [id, type, applyDbData]);

  const download = useDownloadForMedia(media?.id, type, metadata?.source.serviceId);

  // Auto-refresh when download completes (disappears from queue)
  // Sonarr/Radarr may still be importing when the item leaves the queue,
  // so retry a few times if the status isn't 'available' yet.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retryTimerRef.current), [id, type]);

  useOnDownloadComplete(media?.id, () => {
    if (!id || !media) return;
    clearTimeout(retryTimerRef.current);
    invalidateMediaStatus(media.id, type);
    const capturedId = id;

    let retries = 0;
    const check = () => {
      api.get(`/media/tmdb/${capturedId}/${type}`).then(({ data }) => {
        if (id !== capturedId) return;
        applyDbData(data);
        refreshMetadata();
        if (data.statusCategory !== 'AVAILABLE' && !data.inLibrary && retries < 3) {
          retries++;
          retryTimerRef.current = setTimeout(check, 5000);
        }
      }).catch((err) => console.warn('[useMediaDetailData] post-download check failed', err));
    };
    check();
  }, type, metadata?.source.serviceId);

  // Ignore stale dbMedia from a previous page during navigation
  const currentDbMedia = dbMedia && String(dbMedia.tmdbId) === id ? dbMedia : null;

  return {
    media,
    dbMedia: currentDbMedia,
    inLibrary,
    recommendations,
    loading,
    catalog,
    metadata,
    seasonsLoading,
    seasonsError,
    refreshMetadata,
    libraryLoading,
    qualityOptions,
    activeQualityOptionIds,
    audioLanguages,
    subtitleLanguages,
    download,
    blacklisted,
    applyDbData,
    refreshDbData,
  };
}
