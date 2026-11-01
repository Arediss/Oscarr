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
  expect(notes[0].bodyFr).toContain('Quand la session expire');
  expect(notes[0].bodyEn).toContain('When your session expires');
  expect(notes[0].bodyFr).toContain('changements de profil de qualité');
  expect(notes[0].bodyEn).toContain('quality profile changes');
  expect(notes[0].bodyFr).toContain('Les épisodes à venir');
  expect(notes[0].bodyEn).toContain('Upcoming episodes');
  expect(JSON.parse(notes[0].entries)).toEqual([]);
  const latest = await prisma.patchnote.findMany({ orderBy: { date: 'desc' }, take: 15 });
  expect(latest[0].version).toBe('0.10.0');
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
  const dateSql = readFileSync(new URL('../prisma/migrations/20261030233000_patchnote_0100_date/migration.sql', import.meta.url), 'utf8');
  const finalSql = readFileSync(new URL('../prisma/migrations/20261101000000_patchnote_0100_final_fixes/migration.sql', import.meta.url), 'utf8');
  const db = new Database(process.env.DATABASE_URL!.slice('file:'.length));
  try {
    db.exec(sql);
    db.exec(dateSql);
    db.exec(sql);
    db.exec(dateSql);
    const beforeFinal = db.prepare('SELECT * FROM "Patchnote" WHERE "version" = ?').get('0.10.0') as Record<string, unknown>;
    db.exec(finalSql);
    db.exec(finalSql);
    const afterFinal = db.prepare('SELECT * FROM "Patchnote" WHERE "version" = ?').get('0.10.0') as Record<string, unknown>;
    // The correction only replaces the two bodies, retaining date, title, identity and version.
    expect(afterFinal).toEqual({ ...beforeFinal, bodyFr: expect.any(String), bodyEn: expect.any(String) });
  } finally {
    db.close();
  }
  const notes = await prisma.patchnote.findMany({ where: { version: '0.10.0' } });
  expect(notes).toHaveLength(1);
  expect(notes[0].id).toBe(draft.id);
  expect(notes[0].bodyFr).toContain('Sonarr');
  expect(notes[0].bodyEn).toContain('Sonarr');
  const document = readFileSync(new URL('../../../docs/releases/0.10.0.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const [french, english] = document.split('\n---\n\n# English\n');
  expect(notes[0].bodyFr?.replaceAll('\r\n', '\n')).toBe(french.slice(french.indexOf('## ')).trim());
  expect(notes[0].bodyEn?.replaceAll('\r\n', '\n')).toBe(english.trim());
  expect((await prisma.patchnote.findMany({ orderBy: { date: 'desc' }, take: 15 }))[0].version).toBe('0.10.0');
  expect(await prisma.patchnote.findMany({ where: { version: { not: '0.10.0' } }, orderBy: { id: 'asc' } })).toEqual(previous);
  expect(await prisma.postMigrationJob.findMany()).toEqual(jobs);
});
