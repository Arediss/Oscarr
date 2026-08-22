import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import api from '@/lib/api';

/** What the probe learned. Kept separate from the context value so the setter never has to carry
 *  the callback around. */
interface InstallState {
  installed: boolean;
}

interface BackendState extends InstallState {
  /** Called by the install wizard once the backend reports the instance as installed. Without it
   *  the gate keeps its boot-time answer, App keeps routing to /install, InstallPage keeps
   *  routing to /login, and the two bounce off each other until the user reloads by hand. */
  markInstalled: () => void;
}

const BackendContext = createContext<BackendState | null>(null);

/** Blocks rendering until the backend replies to `/setup/install-status`. Retries forever on
 *  network errors and Vite-proxy 5xx so downstream providers never see a transient failure. */
export function BackendGate({ children, fallback }: Readonly<{ children: ReactNode; fallback: ReactNode }>) {
  const [state, setState] = useState<InstallState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      api.get('/setup/install-status')
        .then(({ data }) => {
          if (cancelled) return;
          setState({ installed: !!data.installed });
        })
        .catch((err) => {
          if (cancelled) return;
          const s = err?.response?.status;
          if (!err?.response || (typeof s === 'number' && s >= 500)) {
            setTimeout(probe, 500);
            return;
          }
          setState({ installed: false });
        });
    };
    probe();
    return () => { cancelled = true; };
  }, []);

  if (!state) return <>{fallback}</>;
  return (
    <BackendContext.Provider value={{ ...state, markInstalled: () => setState({ installed: true }) }}>
      {children}
    </BackendContext.Provider>
  );
}

export function useBackend(): BackendState {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error('useBackend must be used within BackendGate');
  return ctx;
}
