import { Link, useLocation, useNavigate, type LinkProps } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { startMediaTransition } from '@/utils/mediaTransition';
import { rememberMediaScroll } from '@/utils/mediaScroll';
import { useRetainMediaHome } from './media/MediaLayers';
import './media/media-transition.css';

/** A normal link, with the cover-to-detail reveal for same-tab activations only. */
export default function MediaLink({ onClick, ...props }: Readonly<LinkProps>) {
  const navigate = useNavigate();
  const location = useLocation();
  const retainHome = useRetainMediaHome();
  return <Link {...props} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || (props.target && props.target !== '_self') || props.reloadDocument || props.download
      || typeof props.to !== 'string' || !/^\/(movie|tv)\/\d+$/.test(props.to)) return;
    event.preventDefault();
    const link = event.currentTarget;
    const cover = link.querySelector('[data-media-cover], img')
      ?? link.parentElement?.querySelector('[data-media-cover]') ?? link;
    const { left, top, width, height } = cover.getBoundingClientRect();
    const rect = { left, top, width, height };
    if (!props.replace) rememberMediaScroll(location.key, window.scrollY);
    const state = { ...props.state, __mediaReturn: props.replace ? undefined : { path: location.pathname, rect, scrollY: window.scrollY } };
    startMediaTransition(props.to, rect, () => {
      // Commit the route or its local Suspense fallback before the native snapshot.
      flushSync(() => {
        const backgroundKey = props.replace ? undefined : retainHome(location, link);
        void navigate(props.to, { replace: props.replace, state: { ...state, __mediaBackgroundKey: backgroundKey } });
      });
    });
  }} />;
}
