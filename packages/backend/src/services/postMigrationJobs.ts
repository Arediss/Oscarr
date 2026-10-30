import { randomUUID } from 'node:crypto';
import { prisma } from '../utils/prisma.js';
import { logEvent } from '../utils/logEvent.js';

const LEASE_MS = 5 * 60_000;
const RETRY_MS = 60_000;

/** Jobs must be idempotent: a crash after their side effects but before completion is recorded
 *  causes a retry. SQL only enqueues names, never executable code or external credentials. */
export async function runPostMigrationJobs(
  execute: (key: string) => Promise<{ skipped: boolean }>,
  stopped: () => boolean = () => false,
): Promise<void> {
  if (stopped()) return;
  const jobs = await prisma.postMigrationJob.findMany({
    where: { completedAt: null, nextAttemptAt: { lte: new Date() } },
    orderBy: [{ createdAt: 'asc' }, { key: 'asc' }], take: 10,
  });
  for (const job of jobs) {
    if (stopped()) break;
    const token = randomUUID();
    const claimed = await prisma.postMigrationJob.updateMany({
      where: { key: job.key, completedAt: null, nextAttemptAt: { lte: new Date() } },
      data: { leaseToken: token, nextAttemptAt: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;
    const owned = { key: job.key, leaseToken: token, completedAt: null };
    // Renew long scans without holding a database transaction around network I/O.
    const heartbeat = setInterval(() => {
      void prisma.postMigrationJob.updateMany({
        where: owned, data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) },
      }).catch(() => logEvent('warn', 'MigrationJob', `Lease renewal failed for ${job.key}`));
    }, 30_000);
    heartbeat.unref();
    try {
      await logEvent('info', 'MigrationJob', `Starting ${job.key} (${job.jobKey}), attempt ${job.attempts + 1}`);
      const outcome = await execute(job.jobKey);
      if (outcome.skipped) {
        await prisma.postMigrationJob.updateMany({ where: owned, data: {
          leaseToken: null, nextAttemptAt: new Date(Date.now() + RETRY_MS),
          lastError: 'Job not executed; waiting for the scheduler.',
        } });
        continue;
      }
      const completed = await prisma.postMigrationJob.updateMany({ where: owned, data: {
        completedAt: new Date(), leaseToken: null, lastError: null,
      } });
      if (completed.count) await logEvent('info', 'MigrationJob', `Completed ${job.key}`);
    } catch {
      // The scheduler owns the detailed diagnostic. Do not copy upstream errors/URLs/secrets
      // into a durable retry record. Retries back off from one minute to one hour.
      const delay = Math.min(60 * RETRY_MS, RETRY_MS * 2 ** Math.min(job.attempts, 6));
      await prisma.postMigrationJob.updateMany({ where: owned, data: {
        leaseToken: null, nextAttemptAt: new Date(Date.now() + delay),
        lastError: 'Job failed; see the scheduler logs. Automatic retry pending.',
      } });
      await logEvent('warn', 'MigrationJob', `Retrying ${job.key} in ${delay / 1000}s`);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
