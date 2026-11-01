import { AxiosError, type AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/i18n', () => ({ default: { language: 'fr', t: (_key: string, fallback: string) => fallback } }));

let api: AxiosInstance;
let session: typeof import('./authSession');
let onExpired: Mock<() => void>;
let unsubscribe: () => void;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('sessionStorage', { getItem: () => null });
  vi.stubGlobal('document', {
    getElementById: () => null,
    createElement: () => ({ style: {}, remove: vi.fn() }),
    body: { appendChild: vi.fn() },
  });
  api = (await import('./api')).default;
  session = await import('./authSession');
  onExpired = vi.fn();
  unsubscribe = session.subscribeSessionExpired(onExpired);
});

afterEach(() => {
  unsubscribe();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Each request has a real Axios config/interceptor chain and a controllable transport.
// Delaying the response reproduces concurrent requests and responses from a previous login.
function request(url: string, method = 'get') {
  let started!: (config: InternalAxiosRequestConfig) => void;
  const dispatched = new Promise<InternalAxiosRequestConfig>(resolve => { started = resolve; });
  let resolve!: (response: AxiosResponse) => void;
  let reject!: (error: AxiosError) => void;
  const response = new Promise<AxiosResponse>((res, rej) => { resolve = res; reject = rej; });
  const result = api.request({
    url, method,
    adapter: config => { started(config); return response; },
  }).then(value => value, error => error as AxiosError);
  return {
    result, dispatched,
    async fail(status: number, code: string) {
      const config = await dispatched;
      const error = new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, {
        config, status, statusText: '', headers: {}, data: { error: code },
      });
      reject(error);
      return error;
    },
    async disconnect() {
      const error = new AxiosError('Network unavailable', AxiosError.ERR_NETWORK, await dispatched);
      reject(error);
      return error;
    },
    async succeed(data: unknown) {
      resolve({ config: await dispatched, status: 200, statusText: 'OK', headers: {}, data });
    },
  };
}

describe('API session expiration', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'ACCOUNT_DISABLED'],
  ])('notifies auth state on %s/%s while preserving the failed request', async (status, code) => {
    const pending = request('/requests');
    const failure = await pending.fail(status, code);

    expect(await pending.result).toBe(failure);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['/admin/users', 403, 'FORBIDDEN'],
    ['/requests', 500, 'INTERNAL_ERROR'],
    ['/auth/login', 401, 'INVALID_CREDENTIALS'],
    ['/admin/backup/restore', 401, 'INVALID_PASSWORD'],
    ['/setup/admin', 401, 'Invalid setup secret'],
  ])('keeps the session for %s returning %s/%s', async (url, status, code) => {
    const version = session.getAuthSessionVersion();
    const pending = request(url, 'post');
    const failure = await pending.fail(status, code);

    expect(await pending.result).toBe(failure);
    expect(onExpired).not.toHaveBeenCalled();
    expect(session.getAuthSessionVersion()).toBe(version);
  });

  it('keeps the session when the network fails', async () => {
    const pending = request('/requests');
    const failure = await pending.disconnect();

    expect(await pending.result).toBe(failure);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('expires once for multiple in-flight requests from the same session', async () => {
    const first = request('/requests');
    const second = request('/downloads');
    await Promise.all([first.dispatched, second.dispatched]);

    await first.fail(401, 'UNAUTHORIZED');
    await first.result;
    await second.fail(401, 'UNAUTHORIZED');
    await second.result;

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('ignores an old unauthorized response after a new login, then handles the new session normally', async () => {
    const oldRequest = request('/requests');
    await oldRequest.dispatched;
    session.advanceAuthSession();

    await oldRequest.fail(401, 'UNAUTHORIZED');
    await oldRequest.result;
    expect(onExpired).not.toHaveBeenCalled();

    const newRequest = request('/requests');
    await newRequest.fail(401, 'UNAUTHORIZED');
    await newRequest.result;
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('delivers successful responses unchanged without expiring the session', async () => {
    const pending = request('/requests');
    const data = { results: [{ id: 7 }] };
    await pending.succeed(data);

    expect(await pending.result).toMatchObject({ status: 200, data });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('removes an auth listener when its provider unmounts', async () => {
    unsubscribe();
    const pending = request('/requests');
    await pending.fail(401, 'UNAUTHORIZED');
    await pending.result;

    expect(onExpired).not.toHaveBeenCalled();
  });
});
