import { describe, it, expect } from 'vitest';
import { isUpdateAvailable } from '../src/utils/updateCheck.js';

/**
 * The check used to be `data.latest !== APP_VERSION`. With version.json left at 0.8.6 while
 * releases had reached 0.8.7, every instance was told an update was available and pointed at an
 * older build — a string comparison cannot tell an upgrade from a downgrade.
 */
describe('isUpdateAvailable', () => {
  it('reports a genuine upgrade', () => {
    expect(isUpdateAvailable('0.8.9', '0.8.7')).toBe(true);
  });

  it('does not offer a downgrade — the regression that shipped', () => {
    expect(isUpdateAvailable('0.8.6', '0.8.7')).toBe(false);
  });

  it('is quiet when already current', () => {
    expect(isUpdateAvailable('0.8.7', '0.8.7')).toBe(false);
  });

  it('orders numerically, not lexicographically', () => {
    expect(isUpdateAvailable('0.10.0', '0.9.0')).toBe(true);
    expect(isUpdateAvailable('0.9.0', '0.10.0')).toBe(false);
  });

  // A malformed or unreachable version.json must not produce an update prompt out of nothing.
  it('stays quiet on unusable input', () => {
    expect(isUpdateAvailable(undefined, '0.8.7')).toBe(false);
    expect(isUpdateAvailable('', '0.8.7')).toBe(false);
    expect(isUpdateAvailable('not-a-version', '0.8.7')).toBe(false);
    expect(isUpdateAvailable('0.9.0', 'not-a-version')).toBe(false);
  });

  it('treats a stable release as newer than its own pre-release', () => {
    expect(isUpdateAvailable('0.9.0', '0.9.0-rc.1')).toBe(true);
  });
});
