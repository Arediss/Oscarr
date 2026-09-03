import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'node:path';
import { pluginDataDirPath, getDataRoot } from '../src/utils/dataPath.js';

/**
 * `rmPluginDataDir` hands this path straight to a recursive, forced delete. The manifest schema
 * already refuses an id that could escape, but nothing tied that regex to this consequence — so
 * the confinement is asserted here, at the place where getting it wrong costs the data root.
 */
describe('pluginDataDirPath', () => {
  const root = () => resolve(getDataRoot(), 'plugins');

  it('resolves a normal id under the plugins directory', () => {
    expect(pluginDataDirPath('radarr')).toBe(resolve(root(), 'radarr'));
    expect(pluginDataDirPath('arediss__oscarr-plugin-reclaim'))
      .toBe(resolve(root(), 'arediss__oscarr-plugin-reclaim'));
  });

  it('refuses anything that climbs out', () => {
    for (const id of ['..', '../..', 'a/../..', '../../etc', '/etc']) {
      expect(() => pluginDataDirPath(id)).toThrow(/escapes the plugins directory/);
    }
  });

  it('refuses an empty id rather than returning the plugins root itself', () => {
    expect(() => pluginDataDirPath('')).toThrow(/escapes the plugins directory/);
    expect(() => pluginDataDirPath('.')).toThrow(/escapes the plugins directory/);
  });

  it('keeps dots that are part of a name, since the id format allows them', () => {
    expect(pluginDataDirPath('a__b.c')).toBe(resolve(root(), 'a__b.c'));
    expect(pluginDataDirPath('a__..')).toBe(`${root()}${sep}a__..`);
  });
});
