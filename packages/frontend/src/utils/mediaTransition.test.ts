import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelMediaTransitionUnless, mediaTransitionReady, startMediaTransition } from './mediaTransition';

const rect = { left: 100, top: 200, width: 180, height: 270 };

function browser({ reduced = false, supported = true } = {}) {
  const animate = vi.fn();
  let finish!: () => void;
  let ready!: () => void;
  let failReady!: () => void;
  let update!: () => Promise<void>;
  const transition = {
    ready: new Promise<void>((resolve, reject) => { ready = resolve; failReady = () => reject(new Error('Skipped')); }),
    finished: new Promise<void>(resolve => { finish = resolve; }),
    skipTransition: vi.fn(() => finish()),
  };
  const start = vi.fn((callback: () => Promise<void>) => { update = callback; return transition; });
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('document', {
    startViewTransition: supported ? start : undefined,
    documentElement: { classList: { add: vi.fn(), remove: vi.fn() }, animate },
  });
  return { start, transition, update: () => update(), finish, ready, failReady, animate };
}

afterEach(() => { cancelMediaTransitionUnless(''); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cover navigation', () => {
  it.each([{ reduced: true }, { supported: false }])('navigates immediately without supported motion (%j)', options => {
    const env = browser(options);
    const navigate = vi.fn();
    startMediaTransition('/tv/1', rect, navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.start).not.toHaveBeenCalled();
  });

  it('waits for the destination, ignoring readiness from another title', async () => {
    const env = browser();
    const navigate = vi.fn();
    startMediaTransition('/tv/1', rect, navigate);
    let ready = false;
    const updating = env.update().then(() => { ready = true; });
    mediaTransitionReady('/tv/2');
    await Promise.resolve();
    expect(ready).toBe(false);
    mediaTransitionReady('/tv/1');
    await updating;
    expect(navigate).toHaveBeenCalledOnce();
    env.finish();
  });

  it('releases a slow or failed page without blocking navigation indefinitely', async () => {
    vi.useFakeTimers();
    const env = browser();
    const navigate = vi.fn();
    startMediaTransition('/tv/1', rect, navigate);
    const updating = env.update();
    await vi.advanceTimersByTimeAsync(1200);
    await updating;
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
    const updating = env.update();
    mediaTransitionReady('/tv/1');
    await updating;
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
    const updating = env.update();
    mediaTransitionReady('/tv/1');
    await updating;
    env.failReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    expect(env.transition.skipTransition).toHaveBeenCalledOnce();
    expect(env.animate).not.toHaveBeenCalled();
  });
});
