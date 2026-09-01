import { describe, it, expect, afterEach } from 'vitest';
import { isSecureCookie } from '../src/utils/authCookie.js';

/**
 * Behind a TLS-terminating reverse proxy the internal hop is plain http, so `request.protocol`
 * reads "http" unless TRUST_PROXY is set. An admin who declares FORCE_HTTPS=true has said the
 * deployment is HTTPS — HSTS is sent on that basis — and would reasonably expect the auth cookie
 * to be Secure too. It was not: FORCE_HTTPS only reached the helmet config.
 */
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('auth cookie Secure flag', () => {
  it('follows the request when nothing is declared', () => {
    delete process.env.COOKIE_SECURE;
    delete process.env.FORCE_HTTPS;
    expect(isSecureCookie('https')).toBe(true);
    expect(isSecureCookie('http')).toBe(false);
  });

  // The gap this test exists for.
  it('is set when the deployment declares HTTPS, even on a plain internal hop', () => {
    delete process.env.COOKIE_SECURE;
    process.env.FORCE_HTTPS = 'true';
    expect(isSecureCookie('http')).toBe(true);
  });

  it('lets COOKIE_SECURE=true force it on', () => {
    process.env.COOKIE_SECURE = 'true';
    delete process.env.FORCE_HTTPS;
    expect(isSecureCookie('http')).toBe(true);
  });

  // A plain-http LAN instance must keep a way out, or nobody can log in.
  it('lets COOKIE_SECURE=false force it off, overriding FORCE_HTTPS', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.FORCE_HTTPS = 'true';
    expect(isSecureCookie('https')).toBe(false);
    expect(isSecureCookie('http')).toBe(false);
  });
});
