import { expect, it } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { seedReleaseNotes } from '../src/services/seed.js';

it('registers the bilingual release once and preserves previous release notes', async () => {
  const previous = await prisma.patchnote.findMany({ where: { version: { not: '0.10.0' } } });
  await seedReleaseNotes();
  await seedReleaseNotes();
  const notes = await prisma.patchnote.findMany({ where: { version: '0.10.0' } });
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ type: 'minor', bodyFr: expect.stringContaining('auto-approbation'), bodyEn: expect.stringContaining('automatic approval') });
  expect(await prisma.patchnote.findMany({ where: { version: { not: '0.10.0' } } })).toEqual(previous);
});
