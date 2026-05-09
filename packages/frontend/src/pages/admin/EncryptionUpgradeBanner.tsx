import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface FlaggedService {
  id: number;
  name: string;
  type: string;
}

/** Custom DOM event ServiceModal (and any future writer) dispatches after a successful save —
 *  lets this banner re-check without coupling either side to the other or pulling in a state
 *  manager. */
export const SERVICE_SAVED_EVENT = 'oscarr:service-saved';

/**
 * Floating bottom-right "upgrade to AES-256-GCM encryption" prompt rendered globally for
 * admins as long as at least one Service row still holds an unencrypted credential.
 *
 * Self-contained: gates on the `admin.*` permission, fetches the security endpoint on mount,
 * re-fetches whenever the window regains focus or a `oscarr:service-saved` event fires, and
 * disappears silently as soon as every service has been re-saved through the encrypted write
 * path.
 */
export function EncryptionUpgradeBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const [services, setServices] = useState<FlaggedService[]>([]);
  const [loaded, setLoaded] = useState(false);

  const isAdmin = !!user && hasPermission('admin.*');

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<{ services: FlaggedService[] }>('/admin/security/services-needing-reencryption');
      setServices(data.services ?? []);
    } catch {
      setServices([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void refresh();
    const onFocus = () => { void refresh(); };
    const onSaved = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(SERVICE_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(SERVICE_SAVED_EVENT, onSaved);
    };
  }, [isAdmin, refresh]);

  if (!isAdmin || !loaded || services.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/admin?tab=services')}
      className="fixed bottom-4 right-4 z-[60] max-w-sm w-[calc(100vw-2rem)] sm:w-auto animate-fade-in flex items-center gap-3 text-left px-4 py-3 rounded-xl border border-amber-500/40 bg-ndp-bg/95 backdrop-blur-xl shadow-2xl shadow-black/60 hover:bg-amber-500/5 transition-colors"
    >
      <Lock className="w-5 h-5 text-amber-300 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-200 text-sm">
          {t('admin.security.plaintext_banner.title', { count: services.length })}
        </p>
        <p className="text-xs text-amber-100/85 mt-0.5">
          {t('admin.security.plaintext_banner.body', { count: services.length })}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-amber-300 flex-shrink-0" aria-hidden />
    </button>
  );
}
