import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
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
// Prisma's Windows schema engine needs the SQLite file to exist before migrate deploy.
closeSync(openSync(dbPath, 'wx'));

process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
process.env.OSCARR_SECRET_KEY = randomBytes(32).toString('hex');
process.env.JWT_SECRET = randomBytes(32).toString('base64');
process.env.NODE_ENV = 'test';

const schema = resolve(import.meta.dirname, '..', 'prisma', 'schema.prisma');
const requireFn = createRequire(import.meta.url);
const prismaPackage = requireFn('prisma/package.json') as { bin: { prisma: string } };
const prismaCli = join(dirname(requireFn.resolve('prisma/package.json')), prismaPackage.bin.prisma);
execFileSync(
  process.execPath,
  [prismaCli, 'migrate', 'deploy', '--schema', schema],
  { stdio: 'pipe', env: process.env, cwd: resolve(import.meta.dirname, '..', '..', '..') },
);

const { prisma } = await import('../src/utils/prisma.js');
afterAll(async () => {
  // Windows cannot remove SQLite files while Prisma still owns their handles.
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
