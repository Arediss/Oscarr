import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync, statSync, createWriteStream } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ZipArchive } from 'archiver';
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

/** VACUUM INTO when sqlite3 CLI is present, raw copyFile fallback otherwise. */
function createDbCopy(dbPath: string, includeCache: boolean): string {
  const tmpPath = resolve(tmpdir(), `oscarr-backup-${randomUUID()}.db`);
  try {
    execFileSync('sqlite3', [dbPath, `VACUUM INTO '${tmpPath}';`], { timeout: 60000 });
  } catch {
    copyFileSync(dbPath, tmpPath);
  }
  if (!includeCache) {
    try {
      execFileSync('sqlite3', [tmpPath, 'DELETE FROM TmdbCache;'], { timeout: 30000 });
      execFileSync('sqlite3', [tmpPath, 'VACUUM;'], { timeout: 30000 });
    } catch { /* sqlite3 not available — keep full DB */ }
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
    // Restore path doesn't yet re-extract these (see TODO in applyDbBuffer); this flag is
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

/** Write a DB buffer to the live path with a pre-restore safety copy for rollback.
 *  Trust chain (all enforced in `routes/admin/backup.ts` /backup/restore):
 *    1. RBAC (admin.* permission) 2. CSRF header 3. rate-limit (3/min)
 *    4. admin password re-auth   5. version-compat check                6. SQLite magic-header match
 *    7. HMAC signature (or explicit BACKUP_ALLOW_UNSIGNED=true opt-in).
 *  By the time the buffer reaches this function it's been validated 7 ways and is NOT untrusted
 *  network data anymore — dbPath is also a constant derived from env/config, never from the body.
 *
 *  TODO: backups now include `plugins/**` (manifest.pluginsDataIncluded), but restore only
 *  re-applies oscarr.db. A follow-up should extract `plugins/**` from the zip into
 *  `data/plugins/` so plugin KV/SQLite data is restored alongside the core DB. */
export function applyDbBuffer(dbBuffer: Buffer): { ok: boolean; safetyPath: string; rollbackFailed?: boolean; error?: string } {
  const dbPath = getDbPath();
  const safetyPath = `${dbPath}.pre-restore.bak`;
  copyFileSync(dbPath, safetyPath);
  try {
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    writeFileSync(dbPath, dbBuffer);
    return { ok: true, safetyPath };
  } catch (writeErr) {
    // Restore failed — try to put the safety copy back. If that ALSO fails, the live DB is
    // broken and the only good copy is safetyPath. Use stderr (not logEvent) since logEvent
    // depends on the DB we just broke.
    const writeMsg = String((writeErr as Error)?.message ?? writeErr);
    try {
      copyFileSync(safetyPath, dbPath);
      return { ok: false, safetyPath, error: writeMsg };
    } catch (rollbackErr) {
      const rollbackMsg = String((rollbackErr as Error)?.message ?? rollbackErr);
      console.error(`[Backup] CRITICAL: restore failed (${writeMsg}) AND rollback failed (${rollbackMsg}). Database may be corrupted; safety copy at ${safetyPath}`);
      return { ok: false, safetyPath, rollbackFailed: true, error: `restore: ${writeMsg}; rollback: ${rollbackMsg}` };
    }
  }
}
