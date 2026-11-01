import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';

export interface HomepageSection {
  id: string;
  type: 'builtin' | 'custom';
  enabled: boolean;
  title: string;
  size?: 'default' | 'large';
  builtinKey?: string;
  endpoint?: string;
  query?: {
    mediaType: 'movie' | 'tv';
    genres?: number[];
    yearGte?: number;
    yearLte?: number;
    releasedWithin?: string;
    voteAverageGte?: number;
    voteCountGte?: number;
    sortBy?: string;
    language?: string;
  };
}

export function useHomepageLayout() {
  const [sections, setSections] = useState<HomepageSection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    const controller = new AbortController();
    api.get('/app/homepage-layout', { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (Array.isArray(data)) {
          setSections(data);
        } else {
          setSections(null); // malformed response -> fallback
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('[useHomepageLayout] failed, using hardcoded default', err);
        setSections(null);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        loaded.current = true;
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return { sections, loading };
}
