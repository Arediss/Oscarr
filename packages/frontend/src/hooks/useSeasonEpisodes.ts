import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TmdbSeasonDetails, SeriesEpisodes, SeriesCatalog } from '@oscarr/shared';
import api from '@/lib/api';
import type { EpisodeInfo } from '@/utils/episodeStatus';
import { selectSeasonEpisodes } from '@/utils/seasonEpisodes';

/** Metadata remains available even for series that have never been requested. */
export function useSeasonEpisodes(tmdbId: number, seasonNumber: number, expanded: boolean, catalog: SeriesCatalog | null = null) {
  const { i18n } = useTranslation();
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'unavailable' | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [stale, setStale] = useState(false);
  const sourceToken = catalog?.source.token;
  const tracked = catalog?.tracked;

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let pending = false;
    setEpisodes(null);
    setError(null);
    setStale(false);
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      setLoading(true);
      try {
        if (sourceToken) {
          const { data } = await api.get<SeriesEpisodes>(`/media/tv/${tmdbId}/seasons/${seasonNumber}/episodes`, {
            params: { source: sourceToken }, signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setEpisodes(selectSeasonEpisodes(null, data.episodes));
          setStale(data.stale);
        } else {
          const { data } = await api.get<TmdbSeasonDetails>(`/tmdb/tv/${tmdbId}/season/${seasonNumber}`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          // TMDB is independently browsable, but its episode numbers prove nothing about files.
          setEpisodes(selectSeasonEpisodes(data.episodes, null));
        }
        setError(null);
        setNow(Date.now());
      } catch {
        if (controller.signal.aborted) return;
        setEpisodes(null);
        setError('unavailable');
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [tmdbId, seasonNumber, expanded, revision, i18n.language, sourceToken, tracked]);

  return { episodes, loading, error, now, stale, retry: () => setRevision(value => value + 1) };
}
