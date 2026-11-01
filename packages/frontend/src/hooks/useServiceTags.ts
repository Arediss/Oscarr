import { useEffect, useState } from 'react';
import type { ServiceTag } from '@oscarr/shared';
import api from '@/lib/api';

export interface ServiceTagsState {
  status: 'loading' | 'ready' | 'error';
  tags: ServiceTag[];
}

/** One catalog per instance, shared by saved rule badges and the open editor. */
export function useServiceTags(serviceIds: number[]) {
  const [catalog, setCatalog] = useState<Record<number, ServiceTagsState>>({});
  const [reload, setReload] = useState(0);
  const idsKey = [...new Set(serviceIds)].sort((a, b) => a - b).join(',');

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',').map(Number) : [];
    let cancelled = false;
    setCatalog(Object.fromEntries(ids.map(id => [id, { status: 'loading', tags: [] }])));
    for (const id of ids) {
      api.get<ServiceTag[]>(`/admin/services/${id}/tags`).then(({ data }) => {
        if (!cancelled) setCatalog(previous => ({ ...previous, [id]: { status: 'ready', tags: data } }));
      }).catch(() => {
        if (!cancelled) setCatalog(previous => ({ ...previous, [id]: { status: 'error', tags: [] } }));
      });
    }
    return () => { cancelled = true; };
  }, [idsKey, reload]);

  return { catalog, refresh: () => setReload(value => value + 1) };
}
