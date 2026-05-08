import { AxiosError } from 'axios';

/** Classifies an error thrown by a service `.test(config)` call into a stable code + a human
 *  message. Callers return the code as `error` (so the UI can i18n it) and the message as
 *  `detail` (pre-rendered English fallback — the UI picks i18n by code when it has one). */
export interface TestErrorInfo {
  code: TestErrorCode;
  message: string;
}

export type TestErrorCode =
  | 'CONNECTION_REFUSED'
  | 'HOST_UNREACHABLE'
  | 'TIMEOUT'
  | 'DNS_FAILED'
  | 'TLS_ERROR'
  | 'HTTP_UNAUTHORIZED'
  | 'HTTP_FORBIDDEN'
  | 'HTTP_NOT_FOUND'
  | 'HTTP_SERVER_ERROR'
  | 'AUTH_FAILED'
  | 'AUTH_BANNED'
  | 'AUTH_NO_SESSION'
  | 'DELUGE_DAEMON_DETACHED'
  | 'UNKNOWN';

export function classifyTestError(err: unknown): TestErrorInfo {
  // axios > 1.x exposes .isAxiosError — but we also accept raw Node errors from providers that
  // don't go through axios (fetch, undici, custom clients).
  const ax = err as AxiosError | undefined;
  const code = (ax?.code ?? (err as { code?: string })?.code ?? '').toString();
  const status = ax?.response?.status;
  const host = ax?.config?.url ? safeHost(ax.config.url) : undefined;
  const message = (err as Error)?.message ?? '';

  if (message === 'AUTH_FAILED') {
    return { code: 'AUTH_FAILED', message: 'Authentication failed — bad username or password' };
  }
  if (message === 'AUTH_BANNED') {
    return { code: 'AUTH_BANNED', message: 'IP temporarily banned after too many failed attempts — wait or restart the service' };
  }
  if (message === 'AUTH_NO_SESSION') {
    return { code: 'AUTH_NO_SESSION', message: 'Login succeeded but the service did not return a session cookie' };
  }
  if (message === 'DELUGE_DAEMON_DETACHED') {
    return { code: 'DELUGE_DAEMON_DETACHED', message: 'Deluge Web is up but not attached to a daemon — connect a daemon in the Deluge UI first' };
  }

  if (status) {
    if (status === 401) return { code: 'HTTP_UNAUTHORIZED', message: 'Authentication failed — check the API key' };
    if (status === 403) return { code: 'HTTP_FORBIDDEN', message: 'Access denied (HTTP 403)' };
    if (status === 404) return { code: 'HTTP_NOT_FOUND', message: 'Endpoint not found (HTTP 404) — check the URL path' };
    if (status >= 500) return { code: 'HTTP_SERVER_ERROR', message: `Service returned HTTP ${status}` };
    return { code: 'UNKNOWN', message: `Unexpected HTTP ${status}` };
  }

  if (code === 'ECONNREFUSED') {
    return {
      code: 'CONNECTION_REFUSED',
      message: host
        ? `Connection refused at ${host}. Nothing is listening, or the service binds only on localhost / a specific interface not reachable from this host.`
        : 'Connection refused. Nothing is listening, or the service binds only on localhost.',
    };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { code: 'HOST_UNREACHABLE', message: host ? `Host unreachable: ${host}` : 'Host unreachable' };
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return { code: 'TIMEOUT', message: host ? `Timed out reaching ${host}` : 'Request timed out' };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { code: 'DNS_FAILED', message: host ? `DNS lookup failed for ${host}` : 'DNS lookup failed' };
  }
  // axios surfaces TLS failures as specific codes; also match on message for node's raw errors.
  if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || /self.?signed|certificate/i.test(String((err as Error)?.message ?? ''))) {
    return { code: 'TLS_ERROR', message: (err as Error)?.message ?? 'TLS certificate error' };
  }

  return { code: 'UNKNOWN', message: message || 'Unknown error' };
}

function safeHost(rawUrl: string): string | undefined {
  try {
    const u = new URL(rawUrl);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return undefined;
  }
}
