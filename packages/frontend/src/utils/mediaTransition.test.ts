import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelMediaTransitionUnless, startMediaTransition } from './mediaTransition';

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
  it('starts the reveal without waiting for the destination fetch', async () => {
    const env = browser();
    const loading = new Promise<void>(() => {});
    const navigate = vi.fn(() => loading);
    startMediaTransition('/tv/1', rect, navigate);
    let snapshotReleased = false;
    void Promise.resolve(env.update()).then(() => { snapshotReleased = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
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
    await next.update();
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
    await env.update();
    await vi.advanceTimersByTimeAsync(250);
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
    await env.update();
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
    await env.update();
    env.failReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.transition.skipTransition).toHaveBeenCalledOnce();
    expect(env.animate).not.toHaveBeenCalled();
  });
});
