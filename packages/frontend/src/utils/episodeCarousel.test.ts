import { describe, expect, it } from 'vitest';
import { episodePageAtOffset, episodePageRanges } from './episodeCarousel';

describe('episode carousel navigation', () => {
  it('keeps the final incomplete group without an extra empty page', () => {
    expect(episodePageRanges(13)).toEqual([{ start: 0, end: 10 }, { start: 10, end: 13 }]);
    expect(episodePageRanges(20)).toEqual([{ start: 0, end: 10 }, { start: 10, end: 20 }]);
    expect(episodePageRanges(1)).toEqual([{ start: 0, end: 1 }]);
    expect(episodePageRanges(0)).toEqual([]);
  });

  it('keeps a group selected while swiping through its ten episodes', () => {
    expect(episodePageAtOffset([0, 2012, 4024], 1600)).toBe(0);
    expect(episodePageAtOffset([0, 2012, 4024], 2012)).toBe(1);
    expect(episodePageAtOffset([0, 2012, 4024], 3900)).toBe(1);
  });

  it('handles fractional scroll positions, overscroll and a shortened list', () => {
    expect(episodePageAtOffset([0, 1408], 1407.6)).toBe(1);
    expect(episodePageAtOffset([0, 1408], -15)).toBe(0);
    expect(episodePageAtOffset([0, 1408], 9000)).toBe(1);
    expect(episodePageAtOffset([0], 1408)).toBe(0);
    expect(episodePageAtOffset([], 0)).toBe(0);
  });
});
