// History keys distinguish visits to the same URL (including different search/filter states).
const positions = new Map<string, number>();

export function rememberMediaScroll(key: string, top: number) {
  positions.delete(key);
  positions.set(key, top);
  if (positions.size > 30) positions.delete(positions.keys().next().value!);
}

export function getMediaScroll(key: string): number | undefined {
  return positions.get(key);
}

/** Reserve enough height for Back before asynchronous rows exist. Stop as soon as the user takes over. */
export function restoreMediaScroll(top: number, container: HTMLElement, content: HTMLElement): () => void {
  const previousMinHeight = container.style.minHeight;
  const previousAnchor = container.style.overflowAnchor;
  const documentTop = container.getBoundingClientRect().top + window.scrollY;
  let stopped = false;
  let restoring = true;
  const update = () => {
    if (stopped) return;
    const requiredHeight = Math.max(0, (restoring ? top : window.scrollY) + window.innerHeight - documentTop);
    const needsSpace = content.getBoundingClientRect().height < requiredHeight;
    container.style.minHeight = needsSpace ? `${requiredHeight}px` : previousMinHeight;
    if (restoring && Math.abs(window.scrollY - top) > 1) window.scrollTo({ top, behavior: 'instant' });
    if (!restoring && !needsSpace) stop();
  };
  const observer = new ResizeObserver(update);
  const removeInputListeners = () => {
    for (const event of ['wheel', 'touchstart', 'pointerdown']) window.removeEventListener(event, releaseControl);
    window.removeEventListener('keydown', onKey);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    observer.disconnect();
    container.style.minHeight = previousMinHeight;
    container.style.overflowAnchor = previousAnchor;
    removeInputListeners();
    window.removeEventListener('resize', update);
  };
  const releaseControl = () => {
    restoring = false;
    clearTimeout(deadline);
    removeInputListeners();
    container.style.overflowAnchor = previousAnchor;
    // Removing the reservation while content is still short would itself scroll to the top.
    // Keep only the size observer until removal is safe, or until the route unmounts.
    update();
  };
  const onKey = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab'].includes(event.key)) releaseControl();
  };
  const deadline = setTimeout(releaseControl, 10000);
  container.style.overflowAnchor = 'none';
  for (const event of ['wheel', 'touchstart', 'pointerdown']) window.addEventListener(event, releaseControl, { passive: true });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', update);
  observer.observe(content);
  update();
  return stop;
}
