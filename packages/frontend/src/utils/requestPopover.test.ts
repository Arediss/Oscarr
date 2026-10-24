import { expect, it } from 'vitest';
import { positionRequestPopover } from './requestPopover';

it('opens below the card when there is enough space', () => {
  expect(positionRequestPopover({ left: 30, top: 150, bottom: 310, width: 400 }, { width: 1200, height: 900 }))
    .toEqual({ left: 30, width: 400, top: 318, maxHeight: 420 });
});
it('opens above a card near the bottom of the viewport', () => {
  expect(positionRequestPopover({ left: 30, top: 600, bottom: 760, width: 400 }, { width: 1200, height: 800 }))
    .toEqual({ left: 30, width: 400, bottom: 208, maxHeight: 420 });
});
it('keeps the panel within the right edge and narrow mobile screens', () => {
  expect(positionRequestPopover({ left: 15, top: 100, bottom: 260, width: 290 }, { width: 320, height: 700 }))
    .toEqual({ left: 12, width: 296, top: 268, maxHeight: 420 });
});
it('stays usable when neither side has enough space', () => {
  expect(positionRequestPopover({ left: 15, top: 25, bottom: 230, width: 290 }, { width: 320, height: 260 }))
    .toEqual({ left: 12, width: 296, top: 12, maxHeight: 236 });
});
