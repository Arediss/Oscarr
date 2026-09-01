import { describe, it, expect, afterEach } from 'vitest';
import { beginMaintenance, endMaintenance, maintenanceReason } from '../src/utils/maintenance.js';

/**
 * The latch used to be a bare string setter, so two concurrent restores both entered and the
 * second one's endMaintenance() reopened the door while the first was still swapping files.
 */
describe('maintenance latch', () => {
  afterEach(() => {
    endMaintenance();
  });

  it('grants the latch to the first caller only', () => {
    expect(beginMaintenance('first')).toBe(true);
    expect(beginMaintenance('second')).toBe(false);
    expect(maintenanceReason()).toBe('first');
  });

  it('reopens once the holder releases', () => {
    expect(beginMaintenance('first')).toBe(true);
    endMaintenance();
    expect(maintenanceReason()).toBeNull();
    expect(beginMaintenance('second')).toBe(true);
  });

  it('is a no-op to release a latch nobody holds', () => {
    endMaintenance();
    expect(maintenanceReason()).toBeNull();
  });
});
