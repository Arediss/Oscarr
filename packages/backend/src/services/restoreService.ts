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
export async function restoreDatabase(dbBuffer: Buffer, pluginData: PluginDataEntry[] = []): Promise<{
  ok: boolean;
  safetyPath: string;
  rollbackFailed?: boolean;
  error?: string;
  pluginFilesRestored?: number;
  pluginFilesRejected?: string[];
}> {
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

  // ── Stage and verify before anything live is touched ──
  let pluginStaging = { staged: 0, rejected: [] as string[] };
  try {
    writeFileSync(stagedPath, dbBuffer);
    assertRestorableSqlite(stagedPath);
    if (pluginData.length > 0) pluginStaging = stagePluginData(pluginData, pluginsStage);
  } catch (err) {
    try { unlinkSync(stagedPath); } catch { /* nothing staged */ }
    rmSync(pluginsStage, { recursive: true, force: true });
    return { ok: false, safetyPath, error: `staged snapshot rejected: ${String((err as Error)?.message ?? err)}` };
  }

  // ── Quiesce: no new requests, no cron jobs, no open connection ──
  // The loser cleans up only its own attempt files (see `attempt` above) and leaves the winner's
  // jobs, connection and staging untouched.
  if (!beginMaintenance('Restoring a backup')) {
    try { unlinkSync(stagedPath); } catch { /* nothing staged */ }
    rmSync(pluginsStage, { recursive: true, force: true });
    return { ok: false, safetyPath, error: 'RESTORE_IN_PROGRESS' };
  }
  stopAllJobs();
  const stillRunning = runningJobKeys();
  if (stillRunning.length > 0) {
    // Nothing to await on — jobs are fire-and-forget — but the operator deserves the breadcrumb
    // if the restore lands mid-sync. Console, not logEvent: the DB is about to go away.
    console.warn(`[Backup] Restoring while these jobs are mid-run: ${stillRunning.join(', ')}`);
  }
  // Plugin SQLite handles point at files the swap below replaces; a handle left open keeps
  // writing into the old inode and holds its WAL/SHM locks. They reopen lazily.
  closeAllPluginStorage();
  await prisma.$disconnect();

  let result: Awaited<ReturnType<typeof restoreDatabase>>;
  try {
    // ── Safety copy of the live trio (db + wal + shm) ──
    if (existsSync(dbPath)) copyFileSync(dbPath, safetyPath);
    for (const suffix of SQLITE_SIDECARS) {
      if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${safetyPath}${suffix}`);
      else { try { unlinkSync(`${safetyPath}${suffix}`); } catch { /* no stale sidecar */ } }
    }

    // ── Atomic swap, then drop the sidecars of the database that just went away ──
    renameSync(stagedPath, dbPath);
    for (const suffix of SQLITE_SIDECARS) {
      try { unlinkSync(`${dbPath}${suffix}`); } catch { /* absent is the expected case */ }
    }

    // Plugin data rides in the archive (manifest.pluginsDataIncluded) but restore used to apply
    // oscarr.db alone: a restored instance came back with core data from the backup and plugin
    // KV/SQLite from whenever. Directory-level swap, so a plugin never sees a half-applied mix.
    if (pluginStaging.staged > 0) {
      rmSync(pluginsSafety, { recursive: true, force: true });
      if (existsSync(pluginsRoot)) renameSync(pluginsRoot, pluginsSafety);
      renameSync(pluginsStage, pluginsRoot);
    }

    // A backup taken by an older Oscarr carries an older schema, and `migrate deploy` is the only
    // thing that closes the gap — boot ran it against the database we just replaced. Throwing here
    // falls into the rollback below, which is the direction we want (R9): a restore refused beats a
    // restored-but-unmigrated database that fails on the first query for a table it never had.
    runMigrateDeploy();

    result = {
      ok: true,
      safetyPath,
      pluginFilesRestored: pluginStaging.staged,
      ...(pluginStaging.rejected.length > 0 ? { pluginFilesRejected: pluginStaging.rejected } : {}),
    };
  } catch (writeErr) {
    const writeMsg = String((writeErr as Error)?.message ?? writeErr);
    try {
      if (existsSync(safetyPath)) copyFileSync(safetyPath, dbPath);
      for (const suffix of SQLITE_SIDECARS) {
        if (existsSync(`${safetyPath}${suffix}`)) copyFileSync(`${safetyPath}${suffix}`, `${dbPath}${suffix}`);
      }
      // Put the plugin directory back too. The swap above happens before `runMigrateDeploy()`, so a
      // failing migration used to roll the database back while leaving the *backup's* plugin state
      // in place — every plugin then read KV/SQLite that no longer matched the database beside it.
      if (pluginStaging.staged > 0 && existsSync(pluginsSafety)) {
        rmSync(pluginsRoot, { recursive: true, force: true });
        renameSync(pluginsSafety, pluginsRoot);
      }
      result = { ok: false, safetyPath, error: writeMsg };
    } catch (rollbackErr) {
      // The live DB is broken and the only good copy is safetyPath. Console, not logEvent —
      // logEvent needs the database we just lost.
      const rollbackMsg = String((rollbackErr as Error)?.message ?? rollbackErr);
      console.error(`[Backup] CRITICAL: restore failed (${writeMsg}) AND rollback failed (${rollbackMsg}). Database may be corrupted; safety copy at ${safetyPath}`);
      result = { ok: false, safetyPath, rollbackFailed: true, error: `restore: ${writeMsg}; rollback: ${rollbackMsg}` };
    }
    try { unlinkSync(stagedPath); } catch { /* already renamed or never written */ }
    rmSync(pluginsStage, { recursive: true, force: true });
  } finally {
    // ── Reopen ──
    try {
      await prisma.$connect();
      // A VACUUM INTO snapshot comes back in journal_mode=delete; the app expects WAL.
      await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    } catch (err) {
      console.error(`[Backup] Reconnect after restore failed: ${String(err)}`);
    }
    endMaintenance();
    await restartJobs().catch((err) => console.error(`[Backup] Job restart after restore failed: ${String(err)}`));
  }

  return result;
}
