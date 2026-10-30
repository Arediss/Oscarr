import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableDragScroll } from './dragScroll';

class ScrollArea extends EventTarget {
  scrollLeft = 120;
  scrollWidth = 1000;
  clientWidth = 400;
  dataset: Record<string, string> = {};
  style = { scrollBehavior: 'smooth', scrollSnapType: 'x proximity' };
  excluded = false;
  captured = new Set<number>();
  closest() { return this.excluded ? this : null; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}
const event = (type: string, props: Record<string, unknown> = {}) => Object.assign(new Event(type, { cancelable: true }), {
  button: 0, buttons: 1, pointerType: 'mouse', pointerId: 1, isPrimary: true, clientX: 200, clientY: 100, detail: 1, ...props,
});
function setup() {
  const window = new EventTarget();
  vi.stubGlobal('window', window);
  vi.stubGlobal('Element', ScrollArea);
  const area = new ScrollArea();
  const cleanup = enableDragScroll(area as unknown as HTMLElement);
  return { area, window, cleanup };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('mouse drag scrolling', () => {
  it('keeps a simple click and small pointer jitter available to the cover link', () => {
    const { area, window, cleanup } = setup();
    area.dispatchEvent(event('pointerdown'));
    window.dispatchEvent(event('pointermove', { clientX: 197 }));
    window.dispatchEvent(event('pointerup'));
    expect(area.scrollLeft).toBe(120);
    expect(area.dispatchEvent(event('click'))).toBe(true);
    cleanup();
  });
  it('drags in both directions and consumes only the release click', () => {
    const { area, window, cleanup } = setup();
    area.dispatchEvent(event('pointerdown'));
    window.dispatchEvent(event('pointermove', { clientX: 100 }));
    expect(area.scrollLeft).toBe(220);
    expect(area.style.scrollSnapType).toBe('none');
    window.dispatchEvent(event('pointermove', { clientX: 250 }));
    expect(area.scrollLeft).toBe(70);
    window.dispatchEvent(event('pointerup'));
    expect(area.style.scrollBehavior).toBe('smooth');
    expect(area.style.scrollSnapType).toBe('x proximity');
    expect(area.dispatchEvent(event('click'))).toBe(false);
    area.dispatchEvent(event('pointerdown'));
    window.dispatchEvent(event('pointerup'));
    expect(area.dispatchEvent(event('click'))).toBe(true);
    cleanup();
  });
  it.each([{ pointerType: 'touch' }, { pointerType: 'pen' }, { button: 2 }, { ctrlKey: true }])('leaves native input untouched for %j', props => {
    const { area, window, cleanup } = setup();
    area.dispatchEvent(event('pointerdown', props));
    window.dispatchEvent(event('pointermove', { clientX: 100 }));
    expect(area.scrollLeft).toBe(120);
    expect(area.dispatchEvent(event('click'))).toBe(true);
    cleanup();
  });
  it('keeps request buttons and non-scrollable rows interactive', () => {
    const { area, window, cleanup } = setup();
    area.excluded = true;
    area.dispatchEvent(event('pointerdown'));
    window.dispatchEvent(event('pointermove', { clientX: 100 }));
    expect(area.scrollLeft).toBe(120);
    area.excluded = false;
    area.scrollWidth = area.clientWidth;
    area.dispatchEvent(event('pointerdown'));
    window.dispatchEvent(event('pointermove', { clientX: 100 }));
    expect(area.scrollLeft).toBe(120);
    cleanup();
  });
  it('cleans up capture and listeners when the page is hidden during a drag', () => {
    const { area, window, cleanup } = setup();
    area.dispatchEvent(event('pointerdown'));
    window.dispatchEvent(event('pointermove', { clientX: 100 }));
    cleanup();
    expect(area.captured.size).toBe(0);
    expect(area.dataset.dragScroll).toBeUndefined();
    window.dispatchEvent(event('pointermove', { clientX: 50 }));
    expect(area.scrollLeft).toBe(220);
    expect(area.dispatchEvent(event('click'))).toBe(true);
  });
  it('never suppresses a keyboard activation after dragging', () => {
    const { area, window, cleanup } = setup();
    area.dispatchEvent(event('pointerdown'));
    window.dispatchEvent(event('pointermove', { clientX: 100 }));
    window.dispatchEvent(event('pointercancel'));
    expect(area.dispatchEvent(event('click', { detail: 0 }))).toBe(true);
    cleanup();
  });
});
