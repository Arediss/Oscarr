import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll } from 'vitest';

/**
 * Every run gets a fresh SQLite file with the real migrations applied — not a hand-built schema.
 * A test suite that drifts from the migrations it is supposed to protect is worse than no suite,
 * because it reports green while production carries a different shape.
 *
 * Secrets are generated per run: nothing here should ever depend on a developer's local .env, and
 * a test that only passes with someone's real key is a test nobody else can run.
 */
const dir = mkdtempSync(join(tmpdir(), 'oscarr-test-'));
const dbPath = join(dir, 'test.db');

process.env.DATABASE_URL = `file:${dbPath}`;
process.env.OSCARR_SECRET_KEY = randomBytes(32).toString('hex');
process.env.JWT_SECRET = randomBytes(32).toString('base64');
process.env.NODE_ENV = 'test';

const schema = resolve(import.meta.dirname, '..', 'prisma', 'schema.prisma');
execFileSync(
  'npx',
  ['prisma', 'migrate', 'deploy', '--schema', schema],
  { stdio: 'pipe', env: process.env, cwd: resolve(import.meta.dirname, '..', '..', '..') },
);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
