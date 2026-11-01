import { expect, it } from 'vitest';
import { MediaStatusCache } from './mediaStatusCache';

it('keeps quality availability when the detail update does not provide it', () => {
  const cache = new MediaStatusCache();
  cache.set('movie:1', { statusCategory: 'AVAILABLE', hasFreeQualityOption: true });
  cache.patch('movie:1', { statusCategory: 'AVAILABLE' });
  expect(cache.get('movie:1')?.hasFreeQualityOption).toBe(true);
  cache.patch('movie:1', { statusCategory: 'AVAILABLE', hasFreeQualityOption: false });
  expect(cache.get('movie:1')?.hasFreeQualityOption).toBe(false);
});

it('does not let an older batch overwrite a fresh detail response', () => {
  const cache = new MediaStatusCache();
  const version = cache.version('tv:1');
  cache.set('tv:1', { statusCategory: 'AVAILABLE' });
  cache.setIfUnchanged('tv:1', version, { statusCategory: 'UNAVAILABLE' });
  expect(cache.get('tv:1')?.statusCategory).toBe('AVAILABLE');
});

it('rejects an in-flight response after invalidation', () => {
  const cache = new MediaStatusCache();
  const version = cache.version('tv:1');
  cache.invalidate('tv:1');
  cache.setIfUnchanged('tv:1', version, { statusCategory: 'UNAVAILABLE' });
  expect(cache.get('tv:1')).toBeUndefined();
});

it('rejects a pending first lookup after clearing all statuses', () => {
  const cache = new MediaStatusCache();
  const version = cache.version('tv:1');
  cache.clear();
  cache.setIfUnchanged('tv:1', version, { statusCategory: 'UNAVAILABLE' });
  expect(cache.get('tv:1')).toBeUndefined();
});
