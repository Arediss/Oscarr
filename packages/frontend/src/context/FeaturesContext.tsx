import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import i18n from 'i18next';
import api from '@/lib/api';

export interface CustomLink {
  id: string;
  label: string;
  url: string;
  icon: string;
  position: 'left' | 'right';
  order: number;
}

interface Features {
  requestsEnabled: boolean;
  calendarEnabled: boolean;
  siteName: string;
  instanceLanguage?: string;
  customLinks?: CustomLink[];
  [key: string]: boolean | string | CustomLink[] | undefined | null;
}

interface FeaturesContextType {
  features: Features;
  loading: boolean;
  refreshFeatures: () => Promise<void>;
}

const defaultFeatures: Features = {
  requestsEnabled: true,
  calendarEnabled: true,
  siteName: 'Oscarr',
};

const FeaturesContext = createContext<FeaturesContextType | null>(null);

export function FeaturesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [features, setFeatures] = useState<Features>(defaultFeatures);
  const [loading, setLoading] = useState(true);

  const refreshFeatures = useCallback(async () => {
    try {
      const { data } = await api.get('/app/features');
      setFeatures(data);
    } catch {
      // Keep current state on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshFeatures();
  }, [refreshFeatures]);

  // Update page title when siteName changes
  useEffect(() => {
    document.title = features.siteName;
  }, [features.siteName]);

  // Sync the UI locale to the instance's setting in prod. In dev we leave whatever the
  // developer has selected from the (dev-only) language switcher — otherwise hot-swapping
  // locales while working on i18n would fight with every backend refetch.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const target = features.instanceLanguage;
    if (target && i18n.language.split('-')[0] !== target) {
      i18n.changeLanguage(target);
    }
  }, [features.instanceLanguage]);

  const ctxValue = useMemo(() => ({ features, loading, refreshFeatures }), [features, loading, refreshFeatures]);

  return (
    <FeaturesContext.Provider value={ctxValue}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures() {
  const ctx = useContext(FeaturesContext);
  if (!ctx) throw new Error('useFeatures must be used within FeaturesProvider');
  return ctx;
}
