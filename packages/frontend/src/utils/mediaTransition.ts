type CoverRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
export interface MediaReturnOrigin { path: string; rect: CoverRect; scrollY: number }
type PendingTransition = {
  path?: string;
  fromPath?: string;
  reverse?: boolean;
  immediate?: boolean;
  scrollY?: number;
  commit?: () => void;
  snapshotTimer?: ReturnType<typeof setTimeout>;
  transition?: ViewTransition;
};
let pending: PendingTransition | undefined;

function clear(current: PendingTransition) {
  clearTimeout(current.snapshotTimer);
  current.commit?.();
  if (pending === current) {
    pending = undefined;
    document.documentElement.classList.remove('media-opening', 'media-closing');
  }
}

export function isMediaReturnDestination(path: string): boolean {
  return !!pending?.reverse && (pending.path ? pending.path === path : pending.fromPath !== path);
}

/** History traversal commits asynchronously. Release its snapshot once React has rendered the route. */
export function completeMediaNavigation(path: string): number | undefined {
  if (pending && !pending.reverse && pending.path === path) {
    pending.commit?.();
    return;
  }
  if (pending && isMediaReturnDestination(path)) {
    pending.path = path;
    pending.commit?.();
    const scrollY = pending.scrollY ?? 0;
    if (pending.immediate) clear(pending);
    return scrollY;
  }
  cancelMediaTransitionUnless(path);
}

export function cancelMediaTransitionUnless(path: string) {
  if (!pending || pending.path === path) return;
  const current = pending;
  current.transition?.skipTransition();
  clear(current);
}

/** Snapshot the committed destination/loading shell immediately, without waiting for data or artwork. */
export function startMediaTransition(path: string, rect: CoverRect, navigate: () => void) {
  runMediaTransition({ path }, rect, navigate);
}

export function startMediaReturnTransition(fromPath: string, origin: MediaReturnOrigin | undefined, fallback: CoverRect, navigate: () => void) {
  runMediaTransition({ path: origin?.path, fromPath, reverse: true, scrollY: origin?.scrollY }, origin?.rect ?? fallback, navigate);
}

function runMediaTransition(current: PendingTransition, rect: CoverRect, navigate: () => void) {
  cancelMediaTransitionUnless('');
  const navigateImmediately = () => {
    if (current.reverse) {
      current.immediate = true;
      pending = current;
      current.snapshotTimer = setTimeout(() => clear(current), 250);
    }
    navigate();
  };
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    navigateImmediately();
    return;
  }
  const x = Math.min(window.innerWidth, Math.max(0, rect.left + rect.width / 2));
  const y = Math.min(window.innerHeight, Math.max(0, rect.top + rect.height / 2));
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  pending = current;
  document.documentElement.classList.add('media-opening');
  if (current.reverse) document.documentElement.classList.add('media-closing');
  try {
    const transition = document.startViewTransition(() => {
      if (pending !== current) return;
      return new Promise<void>(resolve => {
        current.commit = resolve;
        navigate();
      });
    });
    current.transition = transition;
    // A browser snapshot can stall during a resize. Release it instead of freezing the page.
    current.snapshotTimer = setTimeout(() => {
      current.commit?.();
      transition.skipTransition();
    }, 250);
    void transition.ready.then(() => {
      clearTimeout(current.snapshotTimer);
      if (pending !== current) return;
      const clips = [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`];
      document.documentElement.animate({
        clipPath: current.reverse ? clips.reverse() : clips,
      }, {
        duration: 360, easing: 'cubic-bezier(.2,.65,.3,1)',
        pseudoElement: current.reverse ? '::view-transition-old(root)' : '::view-transition-new(root)', fill: 'both',
      });
    }).catch(() => transition.skipTransition());
    void transition.finished.then(() => clear(current), () => clear(current));
  } catch {
    clear(current);
    navigateImmediately();
  }
}
