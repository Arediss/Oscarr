import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';

/**
 * Landing page Plex forwards the OAuth tab to after sign-in (via the `forwardUrl` on the auth URL,
 * #212). It replaces Plex's static "you can now close this window" page — the pain point on mobile,
 * where the original Oscarr tab is backgrounded/suspended and can never poll the PIN to finish.
 *
 * We finalize the session HERE from the tab the user is actually looking at: POST the pin to the
 * login callback (idempotent — safe even when a desktop opener tab already completed via polling),
 * then close the popup (desktop) or, when the browser won't close a plain tab (mobile), redirect
 * back into the app so the user lands logged in instead of stranded.
 */
export default function PlexReturnPage() {
  const { t } = useTranslation();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const pinId = params.get('pinId');
    const state = params.get('state'); // session-binding token; the callback rejects a mismatch
    void (async () => {
      let ok = false;
      if (pinId && state) {
        try { await api.post('/auth/plex/callback', { pinId: Number(pinId), state }); ok = true; } catch { /* ok stays false */ }
      }
      // Desktop popup: close returns focus to the opener (which finished via polling).
      window.close();
      // Mobile / non-closable tab: close() is a no-op there, so land the user back in the app on
      // success, or on the login page (with no session) if finalizing failed.
      window.setTimeout(() => window.location.replace(ok ? '/' : '/login'), 300);
    })();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-ndp-bg text-ndp-text">
      <Loader2 className="w-8 h-8 animate-spin text-ndp-accent" />
      <p className="text-sm text-ndp-text-dim">{t('login.plex_returning')}</p>
    </div>
  );
}
