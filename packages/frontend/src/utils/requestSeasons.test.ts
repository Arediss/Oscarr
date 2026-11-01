import { describe, expect, it } from 'vitest';
import { parseRequestSeasons } from './requestSeasons';

describe('request season scope', () => {
  it('distinguishes separate season requests and sorts multiple seasons', () => {
    expect(parseRequestSeasons('[1]')).toEqual([1]);
    expect(parseRequestSeasons('[2]')).toEqual([2]);
    expect(parseRequestSeasons('[5,2,2]')).toEqual([2, 5]);
  });
  it.each([null, '[]'])('recognizes a whole-series request %s', raw => {
    expect(parseRequestSeasons(raw)).toBe('all');
  });
  it.each(['broken', 'null', '{}', '["1"]', '[0]', '[1.5]'])('does not label an invalid scope as all seasons: %s', raw => {
    expect(parseRequestSeasons(raw)).toBe('unknown');
  });
});
