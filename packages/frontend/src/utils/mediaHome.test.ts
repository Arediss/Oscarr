import { describe, expect, it } from 'vitest';
import type { Location } from 'react-router-dom';
import { keepsMediaHome } from './mediaHome';

const home: Location = { pathname: '/', search: '', hash: '', key: 'home-1', state: null };
const detail = (key: unknown = 'home-1'): Location => ({ ...home, pathname: '/tv/200709', key: 'detail-1', state: { __mediaBackgroundKey: key } });

describe('retained media homepage lifetime', () => {
  it('keeps the original homepage on Back and its detail on Forward', () => {
    expect(keepsMediaHome(home, home)).toBe(true);
    expect(keepsMediaHome(home, detail())).toBe(true);
  });
  it('reuses one homepage across a chain of media details', () => {
    expect(keepsMediaHome(home, { ...detail(), pathname: '/movie/123', key: 'detail-2' })).toBe(true);
  });
  it('does not treat a direct URL or another history entry as an overlay', () => {
    expect(keepsMediaHome(home, { ...detail(), state: null })).toBe(false);
    expect(keepsMediaHome(home, detail('other-home'))).toBe(false);
    expect(keepsMediaHome(home, { ...home, key: 'home-2' })).toBe(false);
  });
  it('releases the homepage when leaving the media flow, even with stale history state', () => {
    for (const pathname of ['/search', '/requests', '/admin', '/login', '/tv/123/other']) {
      expect(keepsMediaHome(home, { ...detail(), pathname })).toBe(false);
    }
  });
});
