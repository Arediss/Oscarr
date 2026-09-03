import { describe, it, expect } from 'vitest';
import { trimTrailingSlashes } from '../src/utils/trimTrailingSlashes.js';

describe('trimTrailingSlashes', () => {
  it('leaves a clean URL alone', () => {
    expect(trimTrailingSlashes('https://radarr.test')).toBe('https://radarr.test');
  });

  it('drops one slash and many', () => {
    expect(trimTrailingSlashes('https://radarr.test/')).toBe('https://radarr.test');
    expect(trimTrailingSlashes('https://radarr.test////')).toBe('https://radarr.test');
  });

  it('keeps slashes that are not at the end', () => {
    expect(trimTrailingSlashes('https://radarr.test/api/v3/')).toBe('https://radarr.test/api/v3');
  });

  it('handles the empty string and an all-slash string', () => {
    expect(trimTrailingSlashes('')).toBe('');
    expect(trimTrailingSlashes('///')).toBe('');
  });

  // The reason this is a loop and not a regex: `/\/+$/` backtracks from every position on a long
  // slash run that is not at the end. A linear scan cannot, so this stays instant.
  it('stays fast on the input that made the regex backtrack', () => {
    const hostile = `https://x.test/${'/'.repeat(60_000)}a`;
    const started = performance.now();
    expect(trimTrailingSlashes(hostile)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
