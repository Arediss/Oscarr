import { useState, useEffect } from 'react';
import api from '@/lib/api';

export interface ServiceField {
  key: string;
  labelKey: string; // i18n key
  type: 'text' | 'password';
  placeholder?: string;
  helper?: string;
}

export interface ServiceSchema {
  id: string;
  label: string;
  icon: string;
  category: 'arr' | 'media-server' | 'download-client' | 'indexer' | 'monitoring';
  fields: ServiceField[];
  untested?: boolean;
}

export interface ServiceData {
  id: number;
  name: string;
  type: string;
  config: Record<string, string>;
  isDefault: boolean;
  enabled: boolean;
  webhookId: number | null;
}

let cachedSchemas: Record<string, ServiceSchema> | null = null;

export function useServiceSchemas(endpoint = '/admin/service-schemas', enabled = true) {
  const [schemas, setSchemas] = useState<Record<string, ServiceSchema>>(cachedSchemas || {});
  const [loading, setLoading] = useState(!cachedSchemas);

  useEffect(() => {
    if (!enabled || cachedSchemas) return;
    api.get(endpoint).then(({ data }) => {
      const map: Record<string, ServiceSchema> = {};
      for (const s of data as ServiceSchema[]) map[s.id] = s;
      cachedSchemas = map;
      setSchemas(map);
    }).catch((err) => console.warn("[useServiceSchemas] failed", err)).finally(() => setLoading(false));
  }, [endpoint, enabled]);

  return { schemas, loading };
}
