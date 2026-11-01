/** Mouse panning supplements native touch/trackpad scrolling without turning drags into link clicks. */
export function enableDragScroll(element: HTMLElement): () => void {
  let gesture: { id: number; x: number; y: number; left: number; dragging: boolean } | undefined;
  let suppressClick = false;
  const behavior = element.style.scrollBehavior;
  const snap = element.style.scrollSnapType;
  const updateCursor = () => {
    if (gesture?.dragging) return;
    if (element.scrollWidth > element.clientWidth) element.dataset.dragScroll = 'ready';
    else delete element.dataset.dragScroll;
  };
  const finish = () => {
    const previous = gesture;
    gesture = undefined;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    window.removeEventListener('blur', finish);
    if (previous?.dragging) {
      element.style.scrollBehavior = behavior;
      element.style.scrollSnapType = snap;
      if (element.hasPointerCapture(previous.id)) element.releasePointerCapture(previous.id);
    }
    updateCursor();
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!(event.buttons & 1)) { finish(); return; }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) { finish(); return; }
      gesture.dragging = true;
      suppressClick = true;
      element.dataset.dragScroll = 'dragging';
      element.style.scrollBehavior = 'auto';
      element.style.scrollSnapType = 'none';
      element.setPointerCapture(gesture.id);
    }
    event.preventDefault();
    element.scrollLeft = gesture.left - dx;
  };
  const down = (event: PointerEvent) => {
    // A new press is a new click candidate, even after a release outside the row.
    suppressClick = false;
    if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary
      || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      || element.scrollWidth <= element.clientWidth
      || (event.target instanceof Element && event.target.closest('button, input, select, textarea, [contenteditable="true"], [role="button"]'))) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, dragging: false };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const preventNativeDrag = (event: Event) => { if (gesture) event.preventDefault(); };
  updateCursor();
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointerenter', updateCursor);
  element.addEventListener('lostpointercapture', finish);
  element.addEventListener('click', click, { capture: true });
  element.addEventListener('dragstart', preventNativeDrag);
  element.addEventListener('selectstart', preventNativeDrag);
  return () => {
    finish();
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointerenter', updateCursor);
    element.removeEventListener('lostpointercapture', finish);
    element.removeEventListener('click', click, { capture: true });
    element.removeEventListener('dragstart', preventNativeDrag);
    element.removeEventListener('selectstart', preventNativeDrag);
    delete element.dataset.dragScroll;
  };
}
