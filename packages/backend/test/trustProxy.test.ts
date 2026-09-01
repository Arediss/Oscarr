import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { resolveTrustProxy } from '../src/utils/trustProxy.js';

/**
 * Whatever this returns is handed straight to Fastify, which compiles it at construction and
 * throws "invalid IP address" on anything it cannot parse — before any of the friendly stderr
 * guidance further down index.ts is reachable. A typo in a .env must degrade to the documented
 * default, not into a boot loop.
 */
function fastifyAccepts(value: unknown): boolean {
  try {
    Fastify({ trustProxy: value as never });
    return true;
  } catch {
    return false;
  }
}

describe('resolveTrustProxy', () => {
  it('keeps the documented forms working', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy('')).toBe(false);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('2')).toBe(2);
    expect(resolveTrustProxy('127.0.0.1')).toBe('127.0.0.1');
    expect(resolveTrustProxy('127.0.0.1,172.18.0.0/16')).toBe('127.0.0.1,172.18.0.0/16');
  });

  it('accepts the casings a human actually types', () => {
    expect(resolveTrustProxy('True')).toBe(true);
    expect(resolveTrustProxy('FALSE')).toBe(false);
    expect(resolveTrustProxy(' true ')).toBe(true);
  });

  // The regression: these used to reach Fastify verbatim and crash it at construction.
  it('falls back to the safe default rather than crashing the process', () => {
    for (const bad of ['yes', 'no', '1,', 'not an ip', '::gg', '10.0.0.0/99']) {
      const resolved = resolveTrustProxy(bad);
      expect(resolved, `${bad} should not reach Fastify verbatim`).toBe(false);
    }
  });

  it('never returns something Fastify refuses to compile', () => {
    for (const input of ['true', 'True', 'false', '3', '127.0.0.1', '172.18.0.0/16', 'yes', '1,', 'garbage', undefined]) {
      expect(fastifyAccepts(resolveTrustProxy(input)), `input ${String(input)}`).toBe(true);
    }
  });
});
