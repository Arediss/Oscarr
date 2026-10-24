import { describe, expect, it } from 'vitest';
import type { MediaRequest } from '@/types';
import { groupRequests } from './requestGroups';

const request = (id: number, mediaId = 10, userId = 1): MediaRequest => ({
  id, mediaId, userId, mediaType: 'tv', seasons: `[${id}]`, status: 'approved',
  rootFolder: null, qualityOptionId: null, approvedById: null, createdAt: '', updatedAt: '',
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
