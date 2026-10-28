type CoverRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
type PendingTransition = {
  path: string;
  snapshotTimer?: ReturnType<typeof setTimeout>;
  transition?: ViewTransition;
};
let pending: PendingTransition | undefined;

function clear(current: PendingTransition) {
  clearTimeout(current.snapshotTimer);
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

/** Snapshot the committed destination/loading shell immediately, without waiting for data or artwork. */
export function startMediaTransition(path: string, rect: CoverRect, navigate: () => void) {
  cancelMediaTransitionUnless('');
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    navigate();
    return;
  }
  const x = Math.min(window.innerWidth, Math.max(0, rect.left + rect.width / 2));
  const y = Math.min(window.innerHeight, Math.max(0, rect.top + rect.height / 2));
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const current: PendingTransition = { path };
  pending = current;
  document.documentElement.classList.add('media-opening');
  try {
    const transition = document.startViewTransition(() => {
      if (pending !== current) return;
      navigate();
    });
    current.transition = transition;
    // A browser snapshot can stall during a resize. Release it instead of freezing the page.
    current.snapshotTimer = setTimeout(() => transition.skipTransition(), 250);
    void transition.ready.then(() => {
      clearTimeout(current.snapshotTimer);
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
