import { describe, it, expect } from 'vitest';
import { addedPermissionLines, removedPermissionLines, type PermissionDiff } from './permissionDiff';

const diff = (over: Partial<PermissionDiff> = {}): PermissionDiff => ({
  services: { added: [], removed: [] },
  capabilities: { added: [], removed: [] },
  capabilityReasons: { added: {}, removed: [], changed: [] },
  ...over,
});

/** The Sonarr Manager 0.1.2 → 0.1.4 update showed each capability twice. */
describe('addedPermissionLines', () => {
  it('lists a documented new capability once, not twice', () => {
    const lines = addedPermissionLines(diff({
      capabilities: { added: ['permissions', 'settings:plugin'], removed: [] },
      capabilityReasons: {
        added: { permissions: 'Declares sonarr.view / sonarr.manage.', 'settings:plugin': 'Stores the storage caps.' },
        removed: [], changed: [],
      },
    }));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.label)).toEqual(['permissions', 'settings:plugin']);
    expect(lines[0].hint).toContain('sonarr.view');
    expect(lines.every((l) => l.granted)).toBe(true);
  });

  it('keeps an undocumented new capability', () => {
    const lines = addedPermissionLines(diff({ capabilities: { added: ['events'], removed: [] } }));
    expect(lines).toEqual([{ key: 'events', label: 'events', hint: undefined, granted: true }]);
  });

  it('marks a reason added to an already-held capability as not newly granted', () => {
    const lines = addedPermissionLines(diff({
      capabilityReasons: { added: { 'storage:plugin': 'Now explained.' }, removed: [], changed: [] },
    }));
    expect(lines).toHaveLength(1);
    expect(lines[0].granted).toBe(false);
  });

  it('carries services through', () => {
    const lines = addedPermissionLines(diff({ services: { added: ['radarr'], removed: [] } }));
    expect(lines[0].label).toBe('service:radarr');
  });

  it('produces unique keys so React never sees a duplicate', () => {
    const lines = addedPermissionLines(diff({
      services: { added: ['radarr'], removed: [] },
      capabilities: { added: ['permissions'], removed: [] },
      capabilityReasons: { added: { permissions: 'a', 'storage:plugin': 'b' }, removed: [], changed: [] },
    }));
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  });
});

describe('removedPermissionLines', () => {
  it('lists a dropped documented capability once', () => {
    const lines = removedPermissionLines(diff({
      capabilities: { added: [], removed: ['settings:plugin'] },
      capabilityReasons: { added: {}, removed: ['settings:plugin'], changed: [] },
    }));
    expect(lines).toHaveLength(1);
  });

  it('reports a reason dropped on a kept capability separately', () => {
    const lines = removedPermissionLines(diff({
      capabilityReasons: { added: {}, removed: ['permissions'], changed: [] },
    }));
    expect(lines).toEqual([{ key: 'reason-permissions', label: 'permissions', granted: false }]);
  });
});
