import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelMediaTransitionUnless, completeMediaNavigation, isMediaReturnDestination, startMediaReturnTransition, startMediaTransition } from './mediaTransition';

const rect = { left: 100, top: 200, width: 180, height: 270 };

function browser({ reduced = false, supported = true } = {}) {
  const animate = vi.fn();
  let finish!: () => void;
  let ready!: () => void;
  let failReady!: () => void;
  let update!: () => void | Promise<void>;
  const transition = {
    ready: new Promise<void>((resolve, reject) => { ready = resolve; failReady = () => reject(new Error('Skipped')); }),
    finished: new Promise<void>(resolve => { finish = resolve; }),
    skipTransition: vi.fn(() => finish()),
  };
  const start = vi.fn((callback: () => void | Promise<void>) => { update = callback; return transition; });
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('document', {
    startViewTransition: supported ? start : undefined,
    documentElement: { classList: { add: vi.fn(), remove: vi.fn() }, animate },
  });
  return { start, transition, update: () => update(), captureUpdate: () => update, finish, ready, failReady, animate };
}

afterEach(() => { cancelMediaTransitionUnless(''); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cover navigation', () => {
  it('captures the committed loading shell without waiting for the destination fetch', async () => {
    const env = browser();
    const loading = new Promise<void>(() => {});
    const navigate = vi.fn(() => loading);
    startMediaTransition('/tv/1', rect, navigate);
    let snapshotReleased = false;
    void Promise.resolve(env.update()).then(() => { snapshotReleased = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    expect(snapshotReleased).toBe(false);
    completeMediaNavigation('/tv/1');
    await Promise.resolve();
    await Promise.resolve();
    expect(snapshotReleased).toBe(true);
    env.finish();
  });

  it.each([{ reduced: true }, { supported: false }])('navigates immediately without supported motion (%j)', options => {
    const env = browser(options);
    const navigate = vi.fn();
    startMediaTransition('/tv/1', rect, navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.start).not.toHaveBeenCalled();
  });

  it('only opens the latest title when another click happens before the snapshot', async () => {
    const env = browser();
    const first = vi.fn();
    const second = vi.fn();
    startMediaTransition('/tv/1', rect, first);
    const obsoleteUpdate = env.captureUpdate();
    const next = browser();
    startMediaTransition('/tv/2', rect, second);
    await obsoleteUpdate();
    const update = next.update();
    completeMediaNavigation('/tv/2');
    await update;
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    next.finish();
  });

  it('still navigates if the browser cannot create a transition', () => {
    const env = browser();
    const navigate = vi.fn();
    env.start.mockImplementationOnce(() => { throw new Error('Unavailable'); });
    startMediaTransition('/tv/1', rect, navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.animate).not.toHaveBeenCalled();
  });

  it('does not freeze the UI if a resize prevents the browser from preparing its snapshot', async () => {
    vi.useFakeTimers();
    const env = browser();
    const navigate = vi.fn();
    startMediaTransition('/tv/1', rect, navigate);
    const update = env.update();
    await vi.advanceTimersByTimeAsync(250);
    await update;
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.transition.skipTransition).toHaveBeenCalledOnce();
  });

  it('does not perform an obsolete navigation after another click or Back', async () => {
    const env = browser();
    const navigate = vi.fn();
    startMediaTransition('/tv/1', rect, navigate);
    cancelMediaTransitionUnless('/search');
    await env.update();
    expect(navigate).not.toHaveBeenCalled();
    expect(env.transition.skipTransition).toHaveBeenCalledOnce();
  });

  it('reveals from the cover center all the way to the farthest viewport corner', async () => {
    const env = browser();
    startMediaTransition('/tv/1', rect, () => {});
    const update = env.update();
    completeMediaNavigation('/tv/1');
    await update;
    env.ready();
    await Promise.resolve();
    const [frames, options] = env.animate.mock.calls[0];
    expect(frames.clipPath[0]).toBe('circle(0px at 190px 335px)');
    expect(Number.parseFloat(frames.clipPath[1].slice(7))).toBeGreaterThanOrEqual(Math.hypot(1010, 465));
    expect(options).toMatchObject({ duration: 360, pseudoElement: '::view-transition-new(root)' });
    env.finish();
  });

  it('keeps the destination usable when the browser skips its snapshot', async () => {
    const env = browser();
    const navigate = vi.fn();
    startMediaTransition('/tv/1', rect, navigate);
    const update = env.update();
    completeMediaNavigation('/tv/1');
    await update;
    env.failReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.transition.skipTransition).toHaveBeenCalledOnce();
    expect(env.animate).not.toHaveBeenCalled();
  });
});

describe('media return navigation', () => {
  it('waits for the history commit, then closes the old page towards the original cover', async () => {
    const env = browser();
    const navigate = vi.fn();
    startMediaReturnTransition('/tv/1', { path: '/search', rect, scrollY: 640 }, rect, navigate);
    let committed = false;
    const update = Promise.resolve(env.update()).then(() => { committed = true; });
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    expect(committed).toBe(false);
    expect(isMediaReturnDestination('/search')).toBe(true);
    expect(completeMediaNavigation('/search')).toBe(640);
    await update;
    env.ready();
    await Promise.resolve();
    const [frames, options] = env.animate.mock.calls[0];
    expect(frames.clipPath[1]).toBe('circle(0px at 190px 335px)');
    expect(Number.parseFloat(frames.clipPath[0].slice(7))).toBeGreaterThanOrEqual(Math.hypot(1010, 465));
    expect(options.pseudoElement).toBe('::view-transition-old(root)');
    env.finish();
  });

  it('can return from a directly opened detail without a remembered cover', async () => {
    const env = browser();
    startMediaReturnTransition('/tv/1', undefined, rect, () => {});
    const update = env.update();
    expect(isMediaReturnDestination('/tv/1')).toBe(false);
    expect(isMediaReturnDestination('/')).toBe(true);
    expect(completeMediaNavigation('/')).toBe(0);
    await update;
    env.finish();
  });

  it('releases a return snapshot when there is no history entry to navigate to', async () => {
    vi.useFakeTimers();
    const env = browser();
    startMediaReturnTransition('/tv/1', undefined, rect, () => {});
    let released = false;
    void Promise.resolve(env.update()).then(() => { released = true; });
    await vi.advanceTimersByTimeAsync(250);
    expect(released).toBe(true);
    expect(env.transition.skipTransition).toHaveBeenCalledOnce();
  });

  it('cancels a reverse reveal when another destination is chosen', async () => {
    const env = browser();
    startMediaReturnTransition('/tv/1', { path: '/search', rect, scrollY: 0 }, rect, () => {});
    const update = env.update();
    completeMediaNavigation('/requests');
    await update;
    expect(isMediaReturnDestination('/search')).toBe(false);
    expect(env.transition.skipTransition).toHaveBeenCalledOnce();
  });

  it.each([{ reduced: true }, { supported: false }])('returns immediately without supported motion (%j)', options => {
    const env = browser(options);
    const navigate = vi.fn();
    startMediaReturnTransition('/tv/1', { path: '/search', rect, scrollY: 640 }, rect, navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.start).not.toHaveBeenCalled();
    expect(completeMediaNavigation('/search')).toBe(640);
    expect(isMediaReturnDestination('/search')).toBe(false);
  });
});
