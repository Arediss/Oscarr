import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';

interface UseTmdbListOptions {
  skip?: boolean;
  transform?: (data: any) => any[];
}

interface UseTmdbListResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useTmdbList<T = any>(
  endpoint: string | null,
  key: string = '',
  options: UseTmdbListOptions = {}
): UseTmdbListResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(!options.skip && !!endpoint);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const loadedRequest = useRef<string | null>(null);
  const requestKey = JSON.stringify([endpoint, key]);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!endpoint || optionsRef.current.skip) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(endpoint, { signal });
      if (signal?.aborted) return;
      const raw = res.data;
      const items = optionsRef.current.transform
        ? optionsRef.current.transform(raw)
        : Array.isArray(raw) ? raw : raw.results || raw.cast || [];
      setData(items);
      loadedRequest.current = requestKey;
    } catch (err: any) {
      if (err.name === 'CanceledError' || signal?.aborted) return;
      setError(err.message || 'Failed to fetch');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint, requestKey]);

  useEffect(() => {
    // Activity resumes effects on Back, while the successful list and its DOM survive.
    if (loadedRequest.current === requestKey) return;
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData, requestKey]);

  const refetch = useCallback(() => { fetchData(); }, [fetchData]);

  return { data, loading, error, refetch };
}
