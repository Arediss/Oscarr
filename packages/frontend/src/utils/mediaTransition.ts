type CoverRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
type PendingTransition = {
  path: string;
  release: () => void;
  timer?: ReturnType<typeof setTimeout>;
  transition?: ViewTransition;
};
let pending: PendingTransition | undefined;

function clear(current: PendingTransition) {
  clearTimeout(current.timer);
  current.release();
  if (pending === current) {
    pending = undefined;
    document.documentElement.classList.remove('media-opening');
  }
}

export function cancelMediaTransitionUnless(path: string) {
  if (!pending || pending.path === path) return;
  const current = pending;
  current.transition?.skipTransition();
  clear(current);
}

/** Called after React commits the destination. Decode its artwork before taking the snapshot. */
export function mediaTransitionReady(path: string, image?: HTMLImageElement | null, heading?: HTMLElement | null) {
  const current = pending;
  if (!current || current.path !== path) return;
  const reveal = () => {
    if (pending !== current) return;
    heading?.focus({ preventScroll: true });
    clearTimeout(current.timer);
    current.release();
  };
  if (image && !image.complete) void image.decode().then(reveal, reveal);
  else reveal();
}

/** Native snapshots retain the old page while React loads the destination (at most 1.2 seconds). */
export function startMediaTransition(path: string, rect: CoverRect, navigate: () => void) {
  cancelMediaTransitionUnless('');
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    navigate();
    return;
  }
  const x = Math.min(window.innerWidth, Math.max(0, rect.left + rect.width / 2));
  const y = Math.min(window.innerHeight, Math.max(0, rect.top + rect.height / 2));
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  let release!: () => void;
  const pageReady = new Promise<void>(resolve => { release = resolve; });
  const current: PendingTransition = { path, release };
  pending = current;
  document.documentElement.classList.add('media-opening');
  try {
    const transition = document.startViewTransition(async () => {
      if (pending !== current) return;
      current.timer = setTimeout(() => {
        transition.skipTransition();
        current.release();
      }, 1200);
      navigate();
      await pageReady;
    });
    current.transition = transition;
    void transition.ready.then(() => {
      if (pending !== current) return;
      document.documentElement.animate({
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
      }, {
        duration: 360, easing: 'cubic-bezier(.2,.65,.3,1)',
        pseudoElement: '::view-transition-new(root)', fill: 'both',
      });
    }).catch(() => transition.skipTransition());
    void transition.finished.then(() => clear(current), () => clear(current));
  } catch {
    clear(current);
    navigate();
  }
}
