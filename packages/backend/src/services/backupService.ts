import { readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync, createWriteStream } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { ZipArchive } from 'archiver';
import Database from 'better-sqlite3';
import { prisma } from '../utils/prisma.js';
import { logEvent } from '../utils/logEvent.js';
import { BACKEND_PRISMA_DIR, PROJECT_PACKAGE_JSON } from '../utils/paths.js';

/** Backup creation + HMAC signing + file rotation. Consumed by routes and scheduler. */

const APP_VERSION = JSON.parse(
  readFileSync(PROJECT_PACKAGE_JSON, 'utf-8'),
).version as string;

export function getBackupAppVersion(): string {
  return APP_VERSION;
}

/** HMAC key derived from JWT_SECRET with a domain tag so it can't be reused for other HMACs. */
function getBackupHmacKey(): Buffer {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET required to sign backups');
  return createHmac('sha256', jwtSecret).update('oscarr-backup-v1').digest();
}

export function hmacOfBuffer(buf: Buffer): string {
  return createHmac('sha256', getBackupHmacKey()).update(buf).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export function getDbPath(): string {
  const url = process.env.DATABASE_URL || 'file:../data/oscarr.db';
  const relativePath = url.replace('file:', '');
  // Prisma resolves `file:` URLs relative to the schema's directory (packages/backend/
  // prisma/), not the package root. The default `file:../data/oscarr.db` therefore points
  // at packages/backend/data/oscarr.db — anchoring on BACKEND_PRISMA_DIR matches Prisma
  // exactly. Anchoring on BACKEND_ROOT (an earlier version of this code) ended up at
  // packages/data/oscarr.db, which doesn't exist → backup job failing with
  // "Database file not found".
  return resolve(BACKEND_PRISMA_DIR, relativePath);
}

export function getBackupDir(): string {
  const dbPath = getDbPath();
  const dir = join(dirname(dbPath), 'backups');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Validate filename + resolve safe path inside backup dir (path-traversal guard). */
export function safeBackupPath(filename: string): string | null {
  if (!/^oscarr-backup-[\w.-]+\.zip$/.test(filename)) return null;
  const dir = getBackupDir();
  const resolved = resolve(dir, filename);
  if (!resolved.startsWith(dir)) return null;
  return resolved;
}

/** Consistent snapshot of the live database.
 *
 *  `VACUUM INTO` runs through better-sqlite3 — the native module the app already ships — instead
 *  of the `sqlite3` CLI, which the production image does not install. The old code shelled out
 *  and fell back to `copyFileSync` on failure, so in that image *every* backup was a raw copy of
 *  the `.db` alone: with `journal_mode = WAL`, every write not yet checkpointed lives in
 *  `<db>-wal` and was silently left out. Worse, the archive's HMAC was then computed over that
 *  truncated copy, so it verified as valid. No fallback here on purpose — a backup that cannot
 *  be taken consistently must fail loudly, not produce a lossy archive.
 *
 *  The source handle is read-only: taking a backup must not be able to mutate the live DB.
 *
 *  Exported for `test/backupRestore.test.ts`, which asserts the WAL contents survive. */
export function createDbCopy(dbPath: string, includeCache: boolean): string {
  const tmpPath = resolve(tmpdir(), `oscarr-backup-${randomUUID()}.db`);

  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    source.prepare('VACUUM INTO ?').run(tmpPath);
  } finally {
    source.close();
  }

  if (!includeCache) {
    const copy = new Database(tmpPath);
    try {
      copy.exec('DELETE FROM TmdbCache');
      copy.exec('VACUUM');
    } finally {
      copy.close();
    }
  }
  return tmpPath;
}

export async function buildManifest(includeCache: boolean) {
  const [userCount, mediaCount, requestCount, cacheCount] = await Promise.all([
    prisma.user.count(),
    prisma.media.count(),
    prisma.mediaRequest.count(),
    prisma.tmdbCache.count(),
  ]);

  const migrations = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at',
  );

  return {
    version: APP_VERSION,
    createdAt: new Date().toISOString(),
    includeCache,
    stats: { users: userCount, media: mediaCount, requests: requestCount, cache: includeCache ? cacheCount : 0 },
    migrations: migrations.map((m) => m.migration_name),
    // True when the backup zip contains plugin-owned KV/SQLite files under `plugins/`.
    // Restore path re-extracts these too (services/restoreService.ts); this flag is
    // forward-compat metadata so a future restore can detect what's available in the zip.
    pluginsDataIncluded: existsSync(join(dirname(getDbPath()), 'plugins')),
  };
}

export async function createBackupZip(
  includeCache: boolean,
  outputPath: string,
): Promise<{ manifest: Record<string, unknown>; size: number }> {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) throw new Error('Database file not found');

  const baseManifest = await buildManifest(includeCache);
  const dbCopy = createDbCopy(dbPath, includeCache);

  const dbBuffer = readFileSync(dbCopy);
  const manifest = { ...baseManifest, integrity: hmacOfBuffer(dbBuffer) };

  await new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(outputPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolvePromise());
    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.file(dbCopy, { name: 'oscarr.db' });

    // Include plugin-owned data (KV files, SQLite DBs + WAL/SHM) so a backup captures
    // everything the user installed plugins persisted. The `*.tmp` exclusion drops
    // half-written KV files an atomic rename hadn't finished yet.
    const pluginsDataDir = join(dirname(getDbPath()), 'plugins');
    if (existsSync(pluginsDataDir)) {
      archive.glob('plugins/**', { cwd: dirname(getDbPath()), ignore: ['plugins/**/*.tmp'] });
    }

    archive.finalize();
  });

  try { unlinkSync(dbCopy); } catch { /* cleanup */ }
  const size = statSync(outputPath).size;
  return { manifest, size };
}

/** Scheduled auto-backup — rotates down to BACKUP_RETENTION (default 7). */
export async function runAutoBackup(): Promise<{ filename: string; size: number }> {
  const dir = getBackupDir();
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 16);
  const filename = `oscarr-backup-auto-${APP_VERSION}-${timestamp}.zip`;
  const outputPath = join(dir, filename);

  const { size } = await createBackupZip(false, outputPath);

  const maxBackups = Number.parseInt(process.env.BACKUP_RETENTION || '7', 10);
  const autoBackups = readdirSync(dir)
    .filter((f) => f.startsWith('oscarr-backup-auto-') && f.endsWith('.zip'))
    .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);

  for (const old of autoBackups.slice(maxBackups)) {
    try { unlinkSync(join(dir, old)); } catch { /* ignore */ }
  }

  logEvent('info', 'Backup', `Auto-backup created: ${filename} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  return { filename, size };
}
