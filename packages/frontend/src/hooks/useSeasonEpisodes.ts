import { useEffect, useState } from 'react';
import axios from 'axios';
import api from '@/lib/api';
import type { EpisodeInfo } from '@/utils/episodeStatus';

/** Only open seasons poll Sonarr. Closing or navigating cancels in-flight responses. */
export function useSeasonEpisodes(tmdbId: number, seasonNumber: number, expanded: boolean) {
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'untracked' | 'unavailable' | null>(null);
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
        const { data } = await api.get<EpisodeInfo[]>('/media/episodes', {
          params: { tmdbId, seasonNumber }, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setEpisodes([...data].sort((a, b) => a.episodeNumber - b.episodeNumber));
        setError(null);
        setNow(Date.now());
      } catch (err) {
        if (controller.signal.aborted) return;
        setEpisodes(null);
        setError(axios.isAxiosError(err) && err.response?.status === 404 ? 'untracked' : 'unavailable');
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [tmdbId, seasonNumber, expanded, revision]);

  return { episodes, loading, error, now, retry: () => setRevision(value => value + 1) };
}
