import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberMediaScroll, getMediaScroll, restoreMediaScroll } from './mediaScroll';

function page() {
  let height = 800;
  let y = 0;
  let minHeight = '';
  let resize!: () => void;
  const events = new EventTarget();
  const clamp = () => { y = Math.min(y, Math.max(0, Math.max(height, Number.parseFloat(minHeight) || 0) - 800)); };
  const container = { style: {
    get minHeight() { return minHeight; },
    set minHeight(value: string) { minHeight = value; clamp(); },
    overflowAnchor: '',
  }, getBoundingClientRect: () => ({ top: -y }) };
  const content = { getBoundingClientRect: () => ({ height }) };
  const disconnect = vi.fn();
  const scrollTo = vi.fn(({ top }: { top: number }) => {
    y = Math.min(top, Math.max(0, Math.max(height, Number.parseFloat(container.style.minHeight) || 0) - 800));
  });
  vi.stubGlobal('window', {
    innerHeight: 800, get scrollY() { return y; }, scrollTo,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect = disconnect;
  });
  return {
    container: container as unknown as HTMLElement, content: content as unknown as HTMLElement,
    events, disconnect, scrollTo, y: () => y,
    grow: (next: number) => { height = next; clamp(); resize(); },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('media return scroll', () => {
  it('keeps the saved position while the homepage is shorter than the viewport, then releases the reserved space', () => {
    const env = page();
    const stop = restoreMediaScroll(1400, env.container, env.content);
    expect(env.y()).toBe(1400);
    expect(env.container.style.minHeight).toBe('2200px');
    env.grow(3400);
    expect(env.y()).toBe(1400);
    expect(env.container.style.minHeight).toBe('');
    // Later rows replacing skeletons must not lose the return position either.
    env.grow(1900);
    expect(env.y()).toBe(1400);
    stop();
    expect(env.disconnect).toHaveBeenCalledOnce();
  });

  it.each(['wheel', 'touchstart', 'pointerdown'])('stops restoring when the user takes control with %s', event => {
    const env = page();
    restoreMediaScroll(1400, env.container, env.content);
    env.events.dispatchEvent(new Event(event));
    expect(env.y()).toBe(1400);
    expect(env.container.style.minHeight).toBe('2200px');
    env.scrollTo.mockClear();
    env.grow(3400);
    expect(env.scrollTo).not.toHaveBeenCalled();
    expect(env.disconnect).toHaveBeenCalledOnce();
    expect(env.container.style.minHeight).toBe('');
  });

  it('releases automatic scrolling after the deadline without collapsing a still-loading page', () => {
    vi.useFakeTimers();
    const env = page();
    restoreMediaScroll(1400, env.container, env.content);
    vi.advanceTimersByTime(10000);
    expect(env.y()).toBe(1400);
    expect(env.container.style.minHeight).toBe('2200px');
    env.scrollTo.mockClear();
    env.grow(3400);
    expect(env.scrollTo).not.toHaveBeenCalled();
    expect(env.disconnect).toHaveBeenCalledOnce();
  });

  it('lets keyboard scrolling take over and restores the previous inline styles', () => {
    const env = page();
    env.container.style.minHeight = '400px';
    env.container.style.overflowAnchor = 'auto';
    restoreMediaScroll(1400, env.container, env.content);
    env.grow(3400);
    const event = new Event('keydown');
    Object.defineProperty(event, 'key', { value: 'PageDown' });
    env.events.dispatchEvent(event);
    expect(env.container.style.minHeight).toBe('400px');
    expect(env.container.style.overflowAnchor).toBe('auto');
    expect(env.disconnect).toHaveBeenCalledOnce();
  });

  it('stores positions by history entry so different searches do not overwrite one another', () => {
    rememberMediaScroll('search-a', 1400);
    rememberMediaScroll('search-b', 2800);
    expect(getMediaScroll('search-a')).toBe(1400);
    expect(getMediaScroll('search-b')).toBe(2800);
    expect(getMediaScroll('unvisited')).toBeUndefined();
  });
});
