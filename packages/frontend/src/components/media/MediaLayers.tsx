import { Activity, createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Outlet, Route, Routes, useLocation, useNavigationType, type Location } from 'react-router-dom';
import { completeMediaNavigation, isMediaReturnDestination } from '@/utils/mediaTransition';
import { getMediaScroll, restoreMediaScroll } from '@/utils/mediaScroll';
import { keepsMediaHome } from '@/utils/mediaHome';

interface RetainedHome {
  location: Location;
  scrollY: number;
  opener: HTMLElement;
}

const RetainHomeContext = createContext<(location: Location, opener: HTMLElement) => string | undefined>(() => undefined);
export const useRetainMediaHome = () => useContext(RetainHomeContext);

function PageTransition({ home }: Readonly<{ home?: RetainedHome | null }>) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const isMediaDetail = /^\/(movie|tv)\//.test(location.pathname);
  const isCircularReturn = useMemo(() => isMediaReturnDestination(location.pathname)
    || (navigationType === 'POP' && getMediaScroll(location.key) !== undefined), [location.key, location.pathname, navigationType]);
  useLayoutEffect(() => {
    if (home) {
      // Retention can commit before the router hides this tree. Do not cancel the
      // outgoing circle by acknowledging the still-visible source as a destination.
      if (isMediaReturnDestination(location.pathname)) completeMediaNavigation(location.pathname);
      // Activity reconnects this effect with the original DOM already present.
      window.scrollTo({ top: home.scrollY, behavior: 'instant' });
      home.opener.focus({ preventScroll: true });
      return;
    }
    const returnScroll = completeMediaNavigation(location.pathname)
      ?? (navigationType === 'POP' ? getMediaScroll(location.key) : undefined);
    if (returnScroll !== undefined && container.current && content.current) {
      return restoreMediaScroll(returnScroll, container.current, content.current);
    } else {
      const immediate = isMediaDetail || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: immediate ? 'instant' : 'smooth' });
    }
  }, [location.key, location.pathname, isMediaDetail, navigationType, home]);
  return (
    <div ref={container} key={location.pathname} className={home || isMediaDetail || isCircularReturn ? undefined : 'animate-fade-in motion-reduce:animate-none'}>
      <div ref={content}><Outlet /></div>
    </div>
  );
}

/** At most one retained homepage and one current detail; other routes release both. */
export default function MediaLayers({ children }: Readonly<{ children: ReactNode }>) {
  const location = useLocation();
  const [home, setHome] = useState<RetainedHome | null>(null);
  const retained = home && keepsMediaHome(home.location, location) ? home : null;
  if (home && !retained) setHome(null);
  const showingDetail = !!retained && location.key !== retained.location.key;

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previous; };
  }, []);

  const retainHome = (source: Location, opener: HTMLElement) => {
    if (source.pathname === '/') {
      setHome({ location: source, scrollY: window.scrollY, opener });
      return source.key;
    }
    return retained?.location.key;
  };

  return (
    <RetainHomeContext.Provider value={retainHome}>
      <Activity mode={showingDetail ? 'hidden' : 'visible'}>
        <div data-media-base={retained ? 'retained' : 'active'} inert={showingDetail} aria-hidden={showingDetail || undefined}>
          <Routes location={retained?.location ?? location}>
            <Route element={<PageTransition home={retained} />}>{children}</Route>
          </Routes>
        </div>
      </Activity>
      {showingDetail && (
        <div data-media-detail>
          <Routes location={location}>
            <Route element={<PageTransition />}>{children}</Route>
          </Routes>
        </div>
      )}
    </RetainHomeContext.Provider>
  );
}
