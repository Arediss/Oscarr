import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prisma } from '../src/utils/prisma.js';

it('installs the complete bilingual 0.10.0 notes through SQL migrations alone', async () => {
  const notes = await prisma.patchnote.findMany({ where: { version: '0.10.0' } });
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({
    type: 'minor',
    date: new Date('2026-10-30T00:00:00.000Z'),
    bodyFr: expect.stringContaining('Sonarr'),
    bodyEn: expect.stringContaining('Sonarr'),
  });
  expect(notes[0].bodyFr).toContain('auto-approbation');
  expect(notes[0].bodyEn).toContain('automatic approval');
  expect(JSON.parse(notes[0].entries)).toEqual([]);
});

it('replaces draft notes without changing their identity, older releases or queued upgrade work', async () => {
  const previous = await prisma.patchnote.findMany({ where: { version: { not: '0.10.0' } }, orderBy: { id: 'asc' } });
  expect(previous.length).toBeGreaterThan(0);
  const jobs = await prisma.postMigrationJob.findMany();
  const draft = await prisma.patchnote.upsert({
    where: { version: '0.10.0' },
    create: { version: '0.10.0', type: 'minor', date: new Date('2026-10-25'), titleFr: 'Brouillon', titleEn: 'Draft', entries: '[]', bodyFr: 'Ancien texte', bodyEn: 'Old text' },
    update: { titleFr: 'Brouillon', titleEn: 'Draft', bodyFr: 'Ancien texte', bodyEn: 'Old text' },
  });
  const sql = readFileSync(new URL('../prisma/migrations/20261030230000_patchnote_0100/migration.sql', import.meta.url), 'utf8');
  const db = new Database(process.env.DATABASE_URL!.slice('file:'.length));
  try {
    db.exec(sql);
    db.exec(sql);
  } finally {
    db.close();
  }
  const notes = await prisma.patchnote.findMany({ where: { version: '0.10.0' } });
  expect(notes).toHaveLength(1);
  expect(notes[0].id).toBe(draft.id);
  expect(notes[0].bodyFr).toContain('Sonarr');
  expect(notes[0].bodyEn).toContain('Sonarr');
  expect(await prisma.patchnote.findMany({ where: { version: { not: '0.10.0' } }, orderBy: { id: 'asc' } })).toEqual(previous);
  expect(await prisma.postMigrationJob.findMany()).toEqual(jobs);
});
