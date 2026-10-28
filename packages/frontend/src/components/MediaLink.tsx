import { Link, useNavigate, type LinkProps } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { startMediaTransition } from '@/utils/mediaTransition';
import './media/media-transition.css';

/** A normal link, with the cover-to-detail reveal for same-tab activations only. */
export default function MediaLink({ onClick, ...props }: Readonly<LinkProps>) {
  const navigate = useNavigate();
  return <Link {...props} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || (props.target && props.target !== '_self') || props.reloadDocument || props.download
      || typeof props.to !== 'string' || !/^\/(movie|tv)\/\d+$/.test(props.to)) return;
    event.preventDefault();
    const link = event.currentTarget;
    const cover = link.querySelector('[data-media-cover], img')
      ?? link.parentElement?.querySelector('[data-media-cover]') ?? link;
    startMediaTransition(props.to, cover.getBoundingClientRect(), () => {
      // Commit the route or its local Suspense fallback before the native snapshot.
      flushSync(() => { void navigate(props.to, { replace: props.replace, state: props.state }); });
    });
  }} />;
}
