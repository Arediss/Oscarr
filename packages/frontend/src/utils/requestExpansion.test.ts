import { expect, it } from 'vitest';
import { positionRequestExpansion } from './requestExpansion';

it('extends the frame downwards from the original card', () => {
  expect(positionRequestExpansion(150, 900)).toEqual({ top: 0, maxHeight: 480 });
});
it('raises the frame near the screen bottom so its labels remain reachable', () => {
  expect(positionRequestExpansion(600, 800)).toEqual({ top: -72, maxHeight: 260 });
});
it('keeps a partially scrolled card within the screen', () => {
  expect(positionRequestExpansion(-50, 700)).toEqual({ top: 62, maxHeight: 480 });
});
it('fits short viewports without extending below the screen', () => {
  expect(positionRequestExpansion(25, 240)).toEqual({ top: -13, maxHeight: 216 });
});
