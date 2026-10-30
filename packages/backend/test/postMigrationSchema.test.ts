import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const up = readFileSync(new URL('../prisma/migrations/20261030200000_post_migration_jobs/migration.sql', import.meta.url), 'utf8');
const down = readFileSync(new URL('../prisma/rollback/20261030200000_post_migration_jobs.sql', import.meta.url), 'utf8');

describe('post-migration SQL', () => {
  it.each([false, true])('queues existing enabled libraries only (library=%s), and supports a non-destructive down path', enabled => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE Service (type TEXT, enabled BOOLEAN); CREATE TABLE Media (title TEXT);');
      db.exec("INSERT INTO Media VALUES ('Keep my library');");
      if (enabled) db.exec("INSERT INTO Service VALUES ('sonarr', 1);");
      db.exec(up);
      const rows = db.prepare('SELECT * FROM PostMigrationJob').all();
      expect(rows).toHaveLength(enabled ? 1 : 0);
      if (enabled) {
        db.exec("UPDATE PostMigrationJob SET completedAt = CURRENT_TIMESTAMP;");
        db.exec(up.slice(up.indexOf('INSERT OR IGNORE')));
        expect(db.prepare('SELECT completedAt FROM PostMigrationJob').get()).toMatchObject({ completedAt: expect.any(String) });
      }
      db.exec(down);
      expect(db.prepare('SELECT * FROM Media').all()).toEqual([{ title: 'Keep my library' }]);
      expect(db.prepare('SELECT * FROM Service').all()).toHaveLength(enabled ? 1 : 0);
    } finally { db.close(); }
  });
});
