import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TmdbSeasonDetails } from '@oscarr/shared';
import api from '@/lib/api';
import type { EpisodeInfo } from '@/utils/episodeStatus';
import { mergeSeasonEpisodes } from '@/utils/seasonEpisodes';

/** Metadata remains available even for series that have never been requested. */
export function useSeasonEpisodes(tmdbId: number, seasonNumber: number, expanded: boolean) {
  const { i18n } = useTranslation();
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'unavailable' | null>(null);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      setLoading(true);
      try {
        const [metadata, library] = await Promise.allSettled([
          api.get<TmdbSeasonDetails>(`/tmdb/tv/${tmdbId}/season/${seasonNumber}`, { signal: controller.signal }),
          api.get<EpisodeInfo[]>('/media/episodes', { params: { tmdbId, seasonNumber }, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        const merged = mergeSeasonEpisodes(
          metadata.status === 'fulfilled' ? metadata.value.data.episodes : null,
          library.status === 'fulfilled' ? library.value.data : null,
        );
        const failed = metadata.status === 'rejected' && merged.length === 0;
        setEpisodes(failed ? null : merged);
        setError(failed ? 'unavailable' : null);
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
  }, [tmdbId, seasonNumber, expanded, revision, i18n.language]);

  return { episodes, loading, error, now, retry: () => setRevision(value => value + 1) };
}
