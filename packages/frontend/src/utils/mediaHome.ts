import type { Location } from 'react-router-dom';

/** History carries only a key; the retained page lives in one in-memory React tree. */
export function keepsMediaHome(home: Location, current: Location): boolean {
  return (current.pathname === '/' && current.key === home.key)
    || (/^\/(movie|tv)\/\d+$/.test(current.pathname)
      && current.state?.__mediaBackgroundKey === home.key);
}
