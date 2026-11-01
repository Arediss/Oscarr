import { describe, expect, it } from 'vitest';
import type { MediaRequest } from '@/types';
import { groupRequests, sortRequestsBySeason } from './requestGroups';

const request = (id: number, mediaId = 10, userId = 1): MediaRequest => ({
  id, mediaId, userId, mediaType: 'tv', seasons: `[${id}]`, status: 'approved',
  rootFolder: null, qualityOptionId: null, approvedById: null, createdAt: '', updatedAt: '',
});

describe('season label order', () => {
  it('sorts numerically without changing the original request order', () => {
    const rows = [request(3), request(11), request(2), request(1), request(10)];
    expect(sortRequestsBySeason(rows).map(row => row.id)).toEqual([1, 2, 3, 10, 11]);
    expect(rows.map(row => row.id)).toEqual([3, 11, 2, 1, 10]);
  });
  it('uses the first season of a multi-season request and keeps non-numbered scopes last', () => {
    const rows = [
      { ...request(20), seasons: null },
      { ...request(21), seasons: '[4,2]' },
      { ...request(22), seasons: 'invalid' },
      request(1),
      { ...request(23), seasons: '[2]', qualityOptionId: 2 },
    ];
    expect(sortRequestsBySeason(rows).map(row => row.id)).toEqual([1, 21, 23, 20, 22]);
  });
  it('preserves movie request order', () => {
    const rows = [request(3), request(1)].map(row => ({ ...row, mediaType: 'movie' as const }));
    expect(sortRequestsBySeason(rows)).toEqual(rows);
  });
});

describe('request cards grouped by media and requester', () => {
  it('keeps seasons, statuses and quality variants in the same card', () => {
    const rows = [request(1), { ...request(2), status: 'pending' as const, qualityOptionId: 2 }];
    expect(groupRequests(rows)).toEqual([rows]);
  });
  it('does not combine different users or media', () => {
    const rows = [request(1), request(2, 10, 2), request(3, 11)];
    expect(groupRequests(rows)).toEqual(rows.map(row => [row]));
  });
  it('deduplicates repeated page rows by request ID and keeps the latest value', () => {
    const updated = { ...request(1), status: 'available' as const };
    expect(groupRequests([request(1), request(2), updated])).toEqual([[updated, request(2)]]);
  });
});
