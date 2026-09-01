import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { prisma } from '../src/utils/prisma.js';
import { loadMasterKeyOrExit } from '../src/utils/secrets.js';

loadMasterKeyOrExit();

const { createDbCopy, getDbPath } = await import('../src/services/backupService.js');
const { restoreDatabase } = await import('../src/services/restoreService.js');

/** Force the connection into WAL, the mode production runs in — that's the whole point here. */
beforeAll(async () => {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
});

const snapshots: string[] = [];
afterEach(() => {
  for (const path of snapshots.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(`${path}${suffix}`); } catch { /* already gone */ }
    }
  }
});

/** Any `.restore.*` file left behind in the data directory — staged snapshots must never survive. */
function leftoverStagingFiles(): string[] {
  const dir = dirname(getDbPath());
  return readdirSync(dir).filter((f) => f.includes('.restore.'));
}

function snapshot(includeCache = true): string {
  const path = createDbCopy(getDbPath(), includeCache);
  snapshots.push(path);
  return path;
}

function readSnapshot<T>(path: string, read: (db: Database.Database) => T): T {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try { return read(db); } finally { db.close(); }
}

async function addUser(email: string): Promise<number> {
  const user = await prisma.user.create({ data: { email, displayName: email, role: 'user' } });
  return user.id;
}

describe('backup snapshot', () => {
  // The regression: production images have no `sqlite3` CLI, so the old code silently fell back
  // to copying the .db alone — everything still sitting in the -wal was dropped from the archive,
  // and the manifest HMAC was computed over that truncated copy, so it verified as valid.
  it('captures writes that are still in the WAL', async () => {
    const email = `wal-${randomUUID()}@test.local`;
    await addUser(email);
    expect(existsSync(`${getDbPath()}-wal`)).toBe(true);

    const found = readSnapshot(snapshot(), (db) =>
      db.prepare('SELECT count(*) AS n FROM User WHERE email = ?').get(email) as { n: number });

    expect(found.n).toBe(1);
  });

  it('produces a sound database', () => {
    const check = readSnapshot(snapshot(), (db) => db.pragma('integrity_check', { simple: true }));
    expect(check).toBe('ok');
  });

  it('drops the TMDB cache when asked, in every environment', async () => {
    await prisma.tmdbCache.create({
      data: { cacheKey: `k-${randomUUID()}`, data: '{}', expiresAt: new Date(Date.now() + 60_000) },
    });

    const kept = readSnapshot(snapshot(true), (db) => db.prepare('SELECT count(*) AS n FROM TmdbCache').get() as { n: number });
    const dropped = readSnapshot(snapshot(false), (db) => db.prepare('SELECT count(*) AS n FROM TmdbCache').get() as { n: number });

    expect(kept.n).toBeGreaterThan(0);
    expect(dropped.n).toBe(0);
  });

  // No silent fallback: a backup that can't be taken consistently must fail, not ship a lossy
  // archive that looks fine.
  it('fails loudly when the database is missing', () => {
    expect(() => createDbCopy(resolve(tmpdir(), `absent-${randomUUID()}.db`), true)).toThrow();
  });
});

describe('restore', () => {
  it('rolls the database back and drops writes made after the backup', async () => {
    const before = `before-${randomUUID()}@test.local`;
    await addUser(before);

    const archive = readFileSync(snapshot());

    const after = `after-${randomUUID()}@test.local`;
    await addUser(after);
    expect(await prisma.user.count({ where: { email: after } })).toBe(1);

    const result = await restoreDatabase(archive);
    expect(result.ok).toBe(true);

    // Prisma is reconnected by the restore itself — no process restart involved.
    expect(await prisma.user.count({ where: { email: before } })).toBe(1);
    expect(await prisma.user.count({ where: { email: after } })).toBe(0);

    // The WAL of the database that was just replaced must not survive: SQLite validates WAL
    // frames against the WAL's own header, not against the database they belong to, so a stale
    // one would be replayed over the restored file. Checkpointing folds whatever WAL exists now
    // into the main file — if a stale frame had survived, `after` would reappear here.
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
    expect(await prisma.user.count({ where: { email: after } })).toBe(0);

    const check = await prisma.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check;');
    expect(check[0].integrity_check).toBe('ok');
  });

  it('refuses a corrupt snapshot without touching the live database', async () => {
    const canary = `canary-${randomUUID()}@test.local`;
    await addUser(canary);

    const corrupt = Buffer.concat([
      Buffer.from('SQLite format 3\0'),
      Buffer.alloc(2048, 0x7f),
    ]);

    const result = await restoreDatabase(corrupt);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/staged snapshot rejected/);
    expect(await prisma.user.count({ where: { email: canary } })).toBe(1);
    // Staging paths carry a per-attempt id now, so asserting one fixed name would pass for the
    // wrong reason. Assert the directory is clean instead.
    expect(leftoverStagingFiles()).toEqual([]);
  });

  it('refuses a sound SQLite file that is not an Oscarr database', async () => {
    const strayPath = resolve(tmpdir(), `stray-${randomUUID()}.db`);
    const stray = new Database(strayPath);
    stray.exec('CREATE TABLE whatever (id INTEGER PRIMARY KEY)');
    stray.close();
    const buffer = readFileSync(strayPath);
    unlinkSync(strayPath);

    const result = await restoreDatabase(buffer);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/_prisma_migrations/);
  });
});

/** Guard the safety copy: it must be a usable database, not a half-written file. */
describe('restore safety copy', () => {
  it('leaves a readable pre-restore copy behind', async () => {
    const marker = `safety-${randomUUID()}@test.local`;
    await addUser(marker);
    const archive = readFileSync(snapshot());
    await addUser(`later-${randomUUID()}@test.local`);

    const result = await restoreDatabase(archive);
    expect(result.ok).toBe(true);

    const safety = new Database(result.safetyPath, { readonly: true, fileMustExist: true });
    try {
      expect(safety.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      safety.close();
    }
  });
});

/**
 * A backup taken by an older Oscarr carries an older schema. Restore used to accept any sound
 * SQLite file with a `_prisma_migrations` table and reconnect on top of it, so the first query
 * against a table that version never had failed at runtime — reproduced in the 2026-08-27 audit.
 *
 * The fixture reverses the newest schema-changing migration by hand to fabricate that older
 * database. If that migration is ever edited, this test breaks loudly — which is the point.
 */
describe('restore of an older backup', () => {
  const MIGRATION = '20260807120000_password_reset_and_mail';

  function ageSnapshot(path: string): void {
    const db = new Database(path, { fileMustExist: true });
    try {
      db.exec('DROP TABLE IF EXISTS "PasswordResetToken"');
      db.exec('DROP TABLE IF EXISTS "MailConfig"');
      db.exec('ALTER TABLE "AppSettings" DROP COLUMN "passwordResetEnabled"');
      db.prepare('DELETE FROM _prisma_migrations WHERE migration_name = ?').run(MIGRATION);
    } finally {
      db.close();
    }
  }

  it('brings the schema forward instead of serving a database that is behind', async () => {
    const staged = snapshot();
    ageSnapshot(staged);

    // Precondition: the fixture really is behind.
    const behind = readSnapshot(staged, (db) =>
      db.prepare('SELECT count(*) AS n FROM _prisma_migrations WHERE migration_name = ?').get(MIGRATION) as { n: number });
    expect(behind.n).toBe(0);

    const result = await restoreDatabase(readFileSync(staged));
    expect(result.ok).toBe(true);

    // The table the old backup never had must exist again, and be queryable through Prisma.
    await expect(prisma.mailConfig.findFirst()).resolves.not.toThrow();

    const applied = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*) AS n FROM _prisma_migrations WHERE migration_name = '${MIGRATION}' AND finished_at IS NOT NULL`,
    );
    expect(Number(applied[0].n)).toBe(1);
  });
});
