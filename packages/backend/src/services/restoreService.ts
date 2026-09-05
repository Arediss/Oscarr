import { randomUUID } from 'node:crypto';
import { writeFileSync, existsSync, copyFileSync, mkdirSync, unlinkSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import { prisma } from '../utils/prisma.js';
import { beginMaintenance, endMaintenance } from '../utils/maintenance.js';
import { runMigrateDeploy } from '../utils/prismaMigrate.js';
import { stopAllJobs, restartJobs, runningJobKeys } from './scheduler.js';
import { getDbPath } from './backupService.js';
import { getDataRoot } from '../utils/dataPath.js';
import { closeAllPluginStorage } from '../plugins/storage/index.js';

/** Restore side of backups. Lives apart from `backupService` because quiescing the instance
 *  needs the scheduler, and the scheduler already imports `runAutoBackup` from there — importing
 *  it back would close an ESM cycle around the module that owns the database path. */

/** Suffixes SQLite keeps alongside the main database file in WAL mode. */
const SQLITE_SIDECARS = ['-wal', '-shm'] as const;

/** Reject anything that isn't a sound Oscarr database before it gets anywhere near the live
 *  path. Runs on the staged file, so a corrupt archive costs nothing. */
function assertRestorableSqlite(path: string): void {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const check = db.pragma('integrity_check', { simple: true });
    if (check !== 'ok') throw new Error(`integrity_check returned "${String(check)}"`);
    const row = db
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'")
      .get() as { n: number } | undefined;
    if (!row?.n) throw new Error('no _prisma_migrations table — not an Oscarr database');
  } finally {
    db.close();
  }
}

/** One file out of an archive's `plugins/**`, as the admin panel extracted it. */
export interface PluginDataEntry {
  /** Archive-relative path, always under `plugins/`. */
  path: string;
  /** File contents, base64. */
  data: string;
}

/** Resolve an archive path to its destination under the data root, or null if it tries to
 *  escape. The buffer reached us through admin RBAC + CSRF + password re-auth, but a path out
 *  of a zip is still a path out of a zip: `resolve` normalises `..` away and the prefix check
 *  is what actually contains it. */
function resolvePluginEntry(archivePath: string): string | null {
  if (typeof archivePath !== 'string' || archivePath.includes('\0')) return null;
  if (!archivePath.startsWith('plugins/') || archivePath.endsWith('/')) return null;

  const root = resolve(getDataRoot(), 'plugins');
  const target = resolve(root, archivePath.slice('plugins/'.length));
  return target.startsWith(root + sep) ? target : null;
}

/** Stage an archive's plugin files into a sibling directory. Runs before the instance is
 *  quiesced — nothing live is touched, so a bad payload costs one temp directory. */
function stagePluginData(entries: PluginDataEntry[], stageRoot: string): { staged: number; rejected: string[] } {
  const root = resolve(getDataRoot(), 'plugins');
  const rejected: string[] = [];
  let staged = 0;

  rmSync(stageRoot, { recursive: true, force: true });
  for (const entry of entries) {
    const target = resolvePluginEntry(entry?.path);
    if (!target) {
      rejected.push(String(entry?.path ?? '<empty>'));
      continue;
    }
    const stagedPath = resolve(stageRoot, target.slice(root.length + 1));
    mkdirSync(dirname(stagedPath), { recursive: true });
    writeFileSync(stagedPath, Buffer.from(entry.data, 'base64'));
    staged++;
  }
  return { staged, rejected };
}

/** Replace the live database with a verified snapshot, under a maintenance window.
 *
 *  Trust chain (all enforced in `routes/admin/backup.ts` /backup/restore):
 *    1. RBAC (admin.* permission) 2. CSRF header 3. rate-limit (3/min)
 *    4. admin password re-auth   5. version-compat check                6. SQLite magic-header match
 *    7. HMAC signature (or explicit BACKUP_ALLOW_UNSIGNED=true opt-in).
 *  By the time the buffer reaches this function it's been validated 7 ways and is NOT untrusted
 *  network data anymore — dbPath is also a constant derived from env/config, never from the body.
 *
 *  The previous implementation wrote the buffer straight over `oscarr.db` with Prisma still
 *  connected, the cron jobs still firing and the old `-wal` still on disk. Three ways to lose
 *  data: the live connection kept serving pages from a file that changed underneath it, SQLite
 *  could replay the stale WAL over the restored database (WAL frames are validated by their own
 *  header salt, not against the database they belong to), and a partial write left no intact
 *  copy. This version stages, verifies, quiesces, swaps atomically and reconnects.
 *
 *  The database side needs no process restart — same stance as the install wizard, which
 *  deliberately avoids depending on an external supervisor. Plugin data is the exception: the
 *  engine caches enabled flags, settings, routers and job handlers in memory and nothing reloads
 *  them here, so the route asks for a restart when plugin files were part of the archive. */
export interface RestoreResult {
  ok: boolean;
  safetyPath: string;
  rollbackFailed?: boolean;
  error?: string;
  pluginFilesRestored?: number;
  pluginFilesRejected?: string[];
}

interface RestorePaths {
  dbPath: string;
  stagedPath: string;
  safetyPath: string;
  pluginsRoot: string;
  pluginsStage: string;
  pluginsSafety: string;
}

interface RestoreSwap {
  databaseReplaced: boolean;
  pluginsMoved: boolean;
  pluginsReplaced: boolean;
}

function prepareRestorePaths(): RestorePaths {
  const dbPath = getDbPath();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  // Same directory as the target, so the rename below is a same-filesystem atomic swap.
  //
  // Unique per attempt: staging runs BEFORE the maintenance latch is claimed, on purpose — a bad
  // payload should cost nothing and touch nothing live. With a fixed name that made two overlapping
  // restores share one file: the second upload overwrote the first's staged snapshot (still a valid
  // SQLite database, so verification passed) and the first renamed the wrong database into place.
  // The loser's cleanup deleted the winner's staged files just as badly. The attempt id is what
  // keeps two callers from ever meeting.
  const attempt = randomUUID();
  const stagedPath = `${dbPath}.restore.${attempt}.tmp`;
  const safetyPath = `${dbPath}.pre-restore.bak`;

  const pluginsRoot = resolve(getDataRoot(), 'plugins');
  const pluginsStage = `${pluginsRoot}.restore.${attempt}`;
  const pluginsSafety = `${pluginsRoot}.pre-restore`;

  return { dbPath, stagedPath, safetyPath, pluginsRoot, pluginsStage, pluginsSafety };
}

function discardStaging(paths: RestorePaths): void {
  try { unlinkSync(paths.stagedPath); } catch { /* already renamed or never written */ }
  rmSync(paths.pluginsStage, { recursive: true, force: true });
}

function copyDatabaseSafety(paths: RestorePaths): void {
  const { dbPath, safetyPath } = paths;
  if (existsSync(dbPath)) copyFileSync(dbPath, safetyPath);
  for (const suffix of SQLITE_SIDECARS) {
    if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${safetyPath}${suffix}`);
    else { try { unlinkSync(`${safetyPath}${suffix}`); } catch { /* no stale sidecar */ } }
  }
}

function swapSnapshot(paths: RestorePaths, includePlugins: boolean, swap: RestoreSwap): void {
  renameSync(paths.stagedPath, paths.dbPath);
  swap.databaseReplaced = true;
  for (const suffix of SQLITE_SIDECARS) {
    try { unlinkSync(`${paths.dbPath}${suffix}`); } catch { /* absent is the expected case */ }
  }

  // Swap the whole directory so plugins never see a half-applied mix of old and restored data.
  if (!includePlugins) return;
  rmSync(paths.pluginsSafety, { recursive: true, force: true });
  if (existsSync(paths.pluginsRoot)) {
    renameSync(paths.pluginsRoot, paths.pluginsSafety);
    swap.pluginsMoved = true;
  }
  renameSync(paths.pluginsStage, paths.pluginsRoot);
  swap.pluginsReplaced = true;
}

function rollbackSnapshot(paths: RestorePaths, swap: RestoreSwap): void {
  // A failure while preparing the safety copy must not roll back from an older attempt's copy.
  if (swap.databaseReplaced) {
    if (existsSync(paths.safetyPath)) copyFileSync(paths.safetyPath, paths.dbPath);
    for (const suffix of SQLITE_SIDECARS) {
      if (existsSync(`${paths.safetyPath}${suffix}`)) copyFileSync(`${paths.safetyPath}${suffix}`, `${paths.dbPath}${suffix}`);
      else { try { unlinkSync(`${paths.dbPath}${suffix}`); } catch { /* no previous sidecar */ } }
    }
  }
  if (swap.pluginsReplaced) rmSync(paths.pluginsRoot, { recursive: true, force: true });
  if (swap.pluginsMoved) renameSync(paths.pluginsSafety, paths.pluginsRoot);
}

function recoverRestore(paths: RestorePaths, swap: RestoreSwap, writeErr: unknown): RestoreResult {
  const writeMsg = String((writeErr as Error)?.message ?? writeErr);
  try {
    rollbackSnapshot(paths, swap);
    return { ok: false, safetyPath: paths.safetyPath, error: writeMsg };
  } catch (rollbackErr) {
    // The database may be unavailable, so this cannot use the database-backed event log.
    const rollbackMsg = String((rollbackErr as Error)?.message ?? rollbackErr);
    console.error(`[Backup] CRITICAL: restore failed (${writeMsg}) AND rollback failed (${rollbackMsg}). Database may be corrupted; safety copy at ${paths.safetyPath}`);
    return { ok: false, safetyPath: paths.safetyPath, rollbackFailed: true, error: `restore: ${writeMsg}; rollback: ${rollbackMsg}` };
  }
}

async function quiesceForRestore(): Promise<void> {
  stopAllJobs();
  const stillRunning = runningJobKeys();
  if (stillRunning.length > 0) {
    console.warn(`[Backup] Restoring while these jobs are mid-run: ${stillRunning.join(', ')}`);
  }
  // Open plugin SQLite handles must release their WAL/SHM locks before directory replacement.
  closeAllPluginStorage();
  await prisma.$disconnect();
}

async function resumeAfterRestore(): Promise<void> {
  try {
    await prisma.$connect();
    // VACUUM INTO snapshots use journal_mode=delete; the app expects WAL.
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  } catch (err) {
    console.error(`[Backup] Reconnect after restore failed: ${String(err)}`);
  }
  endMaintenance();
  await restartJobs().catch((err) => console.error(`[Backup] Job restart after restore failed: ${String(err)}`));
}

/** Stage, verify, quiesce, swap and migrate; roll back any changes if an attempt fails. */
export async function restoreDatabase(dbBuffer: Buffer, pluginData: PluginDataEntry[] = []): Promise<RestoreResult> {
  const paths = prepareRestorePaths();
  const { stagedPath, safetyPath, pluginsStage } = paths;
  let pluginStaging = { staged: 0, rejected: [] as string[] };
  try {
    writeFileSync(stagedPath, dbBuffer);
    assertRestorableSqlite(stagedPath);
    if (pluginData.length > 0) pluginStaging = stagePluginData(pluginData, pluginsStage);
  } catch (err) {
    discardStaging(paths);
    return { ok: false, safetyPath, error: `staged snapshot rejected: ${String((err as Error)?.message ?? err)}` };
  }

  // Losing attempts clean only their own files and leave the active restore untouched.
  if (!beginMaintenance('Restoring a backup')) {
    discardStaging(paths);
    return { ok: false, safetyPath, error: 'RESTORE_IN_PROGRESS' };
  }

  const swap: RestoreSwap = { databaseReplaced: false, pluginsMoved: false, pluginsReplaced: false };
  try {
    await quiesceForRestore();
    copyDatabaseSafety(paths);
    swapSnapshot(paths, pluginStaging.staged > 0, swap);
    // An older backup must migrate before queries resume; failure restores the previous state.
    runMigrateDeploy();

    return {
      ok: true,
      safetyPath,
      pluginFilesRestored: pluginStaging.staged,
      ...(pluginStaging.rejected.length > 0 ? { pluginFilesRejected: pluginStaging.rejected } : {}),
    };
  } catch (writeErr) {
    return recoverRestore(paths, swap, writeErr);
  } finally {
    try {
      discardStaging(paths);
    } finally {
      await resumeAfterRestore();
    }
  }
}
