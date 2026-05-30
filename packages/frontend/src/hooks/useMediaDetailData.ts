import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useNsfwFilter } from '@/hooks/useNsfwFilter';
import { useDownloadForMedia, useOnDownloadComplete } from '@/hooks/useDownloads';
import { invalidateMediaStatus, updateMediaStatusCache } from '@/hooks/useMediaStatus';
import type { MediaStateCategory } from '@oscarr/shared';
import type { TmdbMedia, Media } from '@/types';

interface SonarrSeason {
  seasonNumber: number;
  episodeFileCount: number;
  episodeCount: number;
  totalEpisodeCount: number;
}

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
  const [media, setMedia] = useState<TmdbMedia | null>(null);
  const [dbMedia, setDbMedia] = useState<Media | null>(null);
  const [sonarrSeasons, setSonarrSeasons] = useState<SonarrSeason[]>([]);
  const [inLibrary, setInLibrary] = useState(false);
  const [recommendations, setRecommendations] = useState<TmdbMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>(() => qualityOptionsCache ?? []);
  const [activeQualityOptionIds, setActiveQualityOptionIds] = useState<number[]>([]);
  const [audioLanguages, setAudioLanguages] = useState<string[]>([]);
  const [subtitleLanguages, setSubtitleLanguages] = useState<string[]>([]);
  const [blacklisted, setBlacklisted] = useState<{ blocked: boolean; reason: string | null }>({ blocked: false, reason: null });

  const applyDbData = useCallback((data: Record<string, unknown>) => {
    if (data.id) setDbMedia(data as unknown as Media);
    if (data.sonarrSeasons) setSonarrSeasons(data.sonarrSeasons as SonarrSeason[]);
    if (data.inLibrary) setInLibrary(true);
    if (data.statusCategory === 'AVAILABLE' && !data.id) setInLibrary(true);
    if (data.activeQualityOptionIds) setActiveQualityOptionIds(data.activeQualityOptionIds as number[]);
    if (data.audioLanguages) setAudioLanguages(data.audioLanguages as string[]);
    if (data.subtitleLanguages) setSubtitleLanguages(data.subtitleLanguages as string[]);
    if (data.nsfw && id) addNsfwIds([Number.parseInt(id, 10)]);
    // Update global status cache so list pages reflect the latest state on back navigation
    if (data.statusCategory && id) {
      const tmdbId = Number.parseInt(id, 10);
      if (tmdbId) updateMediaStatusCache(tmdbId, type, data.statusCategory as MediaStateCategory);
    }
  }, [id, type, addNsfwIds]);

  useEffect(() => {
    if (qualityOptionsCache) return;
    loadQualityOptions().then((data) => setQualityOptions(data));
  }, []);

  useEffect(() => {
    setLoading(true);
    setMedia(null);
    // Keep dbMedia until fresh data arrives (prevents button flash)
    setSonarrSeasons([]);
    setInLibrary(false);
    setActiveQualityOptionIds([]);
    setAudioLanguages([]);
    setSubtitleLanguages([]);

    // TMDB and DB fetches are independent — parallel, and flip loading on TMDB arrival so
    // the page renders before the *arr live-check resolves.
    const tmdbPromise = api.get(`/tmdb/${type}/${id}`)
      .then(({ data }) => { setMedia(data); setLoading(false); })
      .catch((err) => { console.error('Failed to fetch media details:', err); setLoading(false); });

    const dbPromise = api.get(`/media/tmdb/${id}/${type}`)
      .then(({ data }) => { applyDbData(data); if (!data.id) setDbMedia(null); })
      .catch((err) => {
        console.warn('[useMediaDetailData] /media/tmdb lookup failed', err);
        setDbMedia(null);
      });

    api.get(`/admin/blacklist/check?tmdbId=${id}&mediaType=${type}`)
      .then(({ data }) => setBlacklisted({ blocked: data.blacklisted, reason: data.reason }))
      .catch((err) => {
        console.warn('[useMediaDetailData] blacklist/check failed', err);
        setBlacklisted({ blocked: false, reason: null });
      });
    api.get(`/tmdb/${type}/${id}/recommendations`).then(({ data }) => {
      setRecommendations(data.results?.map((r: TmdbMedia) => ({ ...r, media_type: type })) || []);
      if (data.nsfwTmdbIds?.length) addNsfwIds(data.nsfwTmdbIds);
    }).catch((err) => console.warn('[useMediaDetailData] /recommendations failed', err));

    void tmdbPromise; void dbPromise;
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

  const download = useDownloadForMedia(media?.id, type);

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
        if (data.statusCategory !== 'AVAILABLE' && !data.inLibrary && retries < 3) {
          retries++;
          retryTimerRef.current = setTimeout(check, 5000);
        }
      }).catch((err) => console.warn('[useMediaDetailData] post-download check failed', err));
    };
    check();
  });

  // Ignore stale dbMedia from a previous page during navigation
  const currentDbMedia = dbMedia && String(dbMedia.tmdbId) === id ? dbMedia : null;

  return {
    media,
    dbMedia: currentDbMedia,
    sonarrSeasons,
    inLibrary,
    recommendations,
    loading,
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
