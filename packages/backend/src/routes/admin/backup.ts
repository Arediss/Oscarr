import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../utils/prisma.js';
import { logEvent } from '../../utils/logEvent.js';
import { verifyPassword } from '../../utils/password.js';
import {
  createBackupZip,
  runAutoBackup,
  getBackupAppVersion,
  getBackupDir,
  safeBackupPath,
  hmacOfBuffer,
  safeEqualHex,
  applyDbBuffer,
} from '../../services/backupService.js';

const APP_VERSION = getBackupAppVersion();

export async function backupRoutes(app: FastifyInstance) {

  // ─── Download backup ────────────────────────────────────────────
  app.get('/backup/create', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        properties: { includeCache: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const includeCache = (request.query as { includeCache?: string }).includeCache === 'true';
    const zipPath = resolve(tmpdir(), `oscarr-download-${randomUUID()}.zip`);

    try {
      const { manifest } = await createBackupZip(includeCache, zipPath);
      const stats = (manifest as { stats: Record<string, number> }).stats;
      const filename = `oscarr-backup-${APP_VERSION}-${new Date().toISOString().slice(0, 10)}.zip`;
      logEvent('info', 'Backup', `Backup downloaded: ${filename} (${stats.users} users, ${stats.media} media, cache: ${includeCache})`);

      const zipBuffer = readFileSync(zipPath);
      try { unlinkSync(zipPath); } catch { /* cleanup */ }

      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(zipBuffer);
    } catch {
      try { unlinkSync(zipPath); } catch { /* cleanup */ }
      return reply.status(500).send({ error: 'Failed to create backup' });
    }
  });

  // ─── List saved backups ─────────────────────────────────────────
  app.get('/backup/list', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => {
    const dir = getBackupDir();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => {
        const stat = statSync(join(dir, f));
        return { filename: f, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return files;
  });

  // ─── Download a saved backup ────────────────────────────────────
  app.get('/backup/download/:filename', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: { type: 'object', required: ['filename'], properties: { filename: { type: 'string' } } } },
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = safeBackupPath(filename);
    if (!filePath) return reply.status(400).send({ error: 'Invalid filename' });
    if (!existsSync(filePath)) return reply.status(404).send({ error: 'Backup not found' });

    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(readFileSync(filePath));
  });

  // ─── Delete a saved backup ──────────────────────────────────────
  app.delete('/backup/:filename', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: { type: 'object', required: ['filename'], properties: { filename: { type: 'string' } } } },
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = safeBackupPath(filename);
    if (!filePath) return reply.status(400).send({ error: 'Invalid filename' });
    if (!existsSync(filePath)) return reply.status(404).send({ error: 'Backup not found' });

    unlinkSync(filePath);
    logEvent('info', 'Backup', `Backup deleted: ${filename}`);
    return { ok: true };
  });

  // ─── Validate backup ───────────────────────────────────────────
  app.post('/backup/validate', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as { manifest?: { version: string; stats: Record<string, number>; migrations: string[] } };
    if (!body?.manifest) return reply.status(400).send({ error: 'Manifest required' });

    const { version, stats, migrations } = body.manifest;
    if (!version || !/^\d+\.\d+\.\d+/.test(version)) return reply.status(400).send({ error: 'Invalid version format' });
    const [major, minor] = version.split('.').map(Number);
    const [curMajor, curMinor] = APP_VERSION.split('.').map(Number);

    if (major > curMajor || (major === curMajor && minor > curMinor)) {
      return reply.status(400).send({ error: 'BACKUP_TOO_NEW', backupVersion: version, currentVersion: APP_VERSION });
    }

    return {
      compatible: true,
      backupVersion: version,
      currentVersion: APP_VERSION,
      needsMigration: version !== APP_VERSION,
      stats,
      migrationsInBackup: migrations?.length ?? 0,
    };
  });

  // Restore gates: HMAC + admin password re-auth + SQLite magic check.
  // Pre-HMAC backups require BACKUP_ALLOW_UNSIGNED=true.
  const maxRestoreSize = Number.parseInt(process.env.BACKUP_MAX_SIZE_MB || '500', 10) * 1024 * 1024;
  app.post('/backup/restore', { bodyLimit: maxRestoreSize, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = request.body as {
      db?: string;
      manifest?: { version: string; integrity?: string };
      password?: string;
    };
    if (!body?.db || !body?.manifest) return reply.status(400).send({ error: 'Database and manifest required' });
    if (!body?.password || typeof body.password !== 'string') {
      return reply.status(400).send({ error: 'PASSWORD_REQUIRED' });
    }

    const actor = request.user;
    const adminUser = await prisma.user.findUnique({ where: { id: actor.id }, select: { passwordHash: true } });
    if (!adminUser?.passwordHash) return reply.status(400).send({ error: 'ADMIN_HAS_NO_PASSWORD' });
    const passwordOk = await verifyPassword(body.password, adminUser.passwordHash);
    if (!passwordOk) {
      logEvent('warn', 'Backup', `Restore rejected: wrong password (user ${actor.id})`);
      return reply.status(401).send({ error: 'INVALID_PASSWORD' });
    }

    const { version, integrity } = body.manifest;
    if (!version || !/^\d+\.\d+\.\d+/.test(version)) return reply.status(400).send({ error: 'Invalid version format' });
    const [major, minor] = version.split('.').map(Number);
    const [curMajor, curMinor] = APP_VERSION.split('.').map(Number);
    if (major > curMajor || (major === curMajor && minor > curMinor)) {
      return reply.status(400).send({ error: 'BACKUP_TOO_NEW' });
    }

    const dbBuffer = Buffer.from(body.db, 'base64');
    const SQLITE_MAGIC = Buffer.from('SQLite format 3\x00');
    if (dbBuffer.length < 16 || !dbBuffer.subarray(0, 16).equals(SQLITE_MAGIC)) {
      return reply.status(400).send({ error: 'Invalid database file' });
    }

    if (integrity) {
      const expected = hmacOfBuffer(dbBuffer);
      if (!safeEqualHex(integrity, expected)) {
        logEvent('error', 'Backup', `Restore rejected: HMAC mismatch (user ${actor.id})`);
        return reply.status(400).send({ error: 'BACKUP_SIGNATURE_INVALID' });
      }
    } else if (process.env.BACKUP_ALLOW_UNSIGNED !== 'true') {
      return reply.status(400).send({ error: 'BACKUP_UNSIGNED' });
    }

    const result = applyDbBuffer(dbBuffer);
    if (!result.ok) {
      if (result.rollbackFailed) {
        logEvent('error', 'Backup', `CRITICAL: restore + rollback both failed. safetyPath=${result.safetyPath} details=${result.error}`);
        return reply.status(500).send({
          error: 'BACKUP_RESTORE_AND_ROLLBACK_FAILED',
          message: 'Database restore failed and the safety rollback also failed. Recover manually from the safety copy.',
          safetyPath: result.safetyPath,
          details: result.error,
        });
      }
      logEvent('warn', 'Backup', `Restore failed, rolled back to safety copy. details=${result.error}`);
      return reply.status(500).send({ error: 'Failed to write database. Original restored.', details: result.error });
    }

    logEvent('info', 'Backup', `Database restored from v${version} backup by user ${actor.id}. Restart required.`);
    return { ok: true, message: 'Database restored. Restart required.', needsRestart: true };
  });
}

// Re-export so legacy importers still work — scheduler and any other caller should import
// from services/backupService directly going forward.
export { runAutoBackup };
