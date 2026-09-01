import { describe, it, expect } from 'vitest';
import { paginate, DEFAULT_PAGINATION_LIMITS } from '../src/importers/paginate.js';

const PAGE_SIZE = 100;

/** A source that hands back `total` rows, PAGE_SIZE at a time. */
function sourceOf(total: number, tick?: (page: number) => void) {
  let page = 0;
  return async (skip: number, take: number) => {
    tick?.(page++);
    const results = Array.from(
      { length: Math.max(0, Math.min(take, total - skip)) },
      (_, i) => ({ id: skip + i }),
    );
    return { results, pageInfo: { results: total } };
  };
}

const limits = { ...DEFAULT_PAGINATION_LIMITS, pageSize: PAGE_SIZE };

describe('paginate', () => {
  it('walks every page of a large history', async () => {
    const rows = await paginate(sourceOf(250), limits, '/request');
    expect(rows).toHaveLength(250);
    expect(rows[0]).toEqual({ id: 0 });
    expect(rows[249]).toEqual({ id: 249 });
  });

  it('stops on the first short page', async () => {
    let calls = 0;
    await paginate(sourceOf(150, () => { calls++; }), limits, '/request');
    expect(calls).toBe(2);
  });

  it('handles an empty source without a request storm', async () => {
    const rows = await paginate(sourceOf(0), limits, '/request');
    expect(rows).toEqual([]);
  });



  it('refuses to keep paging past the row ceiling', async () => {
    await expect(
      paginate(sourceOf(10_000), { ...limits, maxRows: 300 }, '/request'),
    ).rejects.toThrow(/more than 300 rows/);
  });

  it('refuses to keep paging past the page ceiling', async () => {
    await expect(
      paginate(sourceOf(10_000), { ...limits, maxPages: 3 }, '/request'),
    ).rejects.toThrow(/more than 3 pages/);
  });

  // The defaults are the whole point of the change: 5 minutes and 20 000 rows were tight enough
  // that a real library could trip them on migration day.
  it('ships defaults generous enough for a real instance', () => {
    expect(DEFAULT_PAGINATION_LIMITS.maxRows).toBeGreaterThanOrEqual(200_000);
    expect(DEFAULT_PAGINATION_LIMITS.maxPages).toBeGreaterThanOrEqual(2_000);
  });

  // A source that goes quiet is bounded by the per-request abort in seerrFetch, not here. This
  // pins the contract that made the old stall ceiling dead code: paginate propagates the abort
  // rather than owning a competing timeout of its own.
  it('propagates a request-level abort instead of swallowing it', async () => {
    const boom = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    await expect(paginate(async () => { throw boom; }, limits, '/request'))
      .rejects.toThrow(/aborted/);
  });
});
