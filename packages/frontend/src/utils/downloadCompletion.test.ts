import { expect, it } from 'vitest';
import { activeDownloadKeys, downloadSubscriptionKey } from './downloadCompletion';

it('detects completion on A while the same TV title continues downloading on B', () => {
  const a = { tmdbId: 60572, mediaType: 'tv', serviceId: 1 };
  const b = { ...a, serviceId: 2 };
  const before = activeDownloadKeys([a, b]);
  const after = activeDownloadKeys([b]);
  const completed = [...before].filter(key => !after.has(key));
  expect(completed).toContain(downloadSubscriptionKey(60572, 'tv', 1));
  expect(completed).not.toContain(downloadSubscriptionKey(60572, 'tv', 2));
  expect(completed).not.toContain(downloadSubscriptionKey(60572));
});
it('separates movie and TV identifiers while keeping aggregate subscriptions compatible', () => {
  const before = activeDownloadKeys([{ tmdbId: 1, mediaType: 'movie', serviceId: 1 }, { tmdbId: 1, mediaType: 'tv', serviceId: 2 }]);
  const after = activeDownloadKeys([{ tmdbId: 1, mediaType: 'tv', serviceId: 2 }]);
  expect([...before].filter(key => !after.has(key))).toContain(downloadSubscriptionKey(1, 'movie'));
  expect(after.has(downloadSubscriptionKey(1))).toBe(true);
});
