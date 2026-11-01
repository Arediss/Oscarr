import { expect, it } from 'vitest';
import { cardRequestAction } from './cardRequestAction';

it('does not offer a request before availability is known or when requests are disabled', () => {
  expect(cardRequestAction(null, true, 'movie')).toBe('none');
  expect(cardRequestAction({ statusCategory: 'UNAVAILABLE' }, false, 'movie')).toBe('none');
});
it('offers a picker for a genuine free quality and for season selection', () => {
  expect(cardRequestAction({ statusCategory: 'AVAILABLE' }, true, 'movie')).toBe('none');
  expect(cardRequestAction({ statusCategory: 'AVAILABLE', hasFreeQualityOption: true }, true, 'movie')).toBe('details');
  expect(cardRequestAction({ statusCategory: 'UNAVAILABLE' }, true, 'tv')).toBe('details');
});
it('does not offer duplicate or blocked requests', () => {
  expect(cardRequestAction({ statusCategory: 'UNAVAILABLE', requestStatus: 'approved' }, true, 'movie')).toBe('none');
  expect(cardRequestAction({ statusCategory: 'BLACKLISTED', hasFreeQualityOption: true }, true, 'movie')).toBe('none');
});
