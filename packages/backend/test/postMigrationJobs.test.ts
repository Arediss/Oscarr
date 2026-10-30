import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { readFileSync } from 'node:fs';
import { runPostMigrationJobs } from '../src/services/postMigrationJobs.js';

vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));

beforeEach(async () => {
  await prisma.postMigrationJob.deleteMany();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const enqueue = (key = 'refresh') => prisma.postMigrationJob.create({
  data: { key, jobKey: 'full_sync', nextAttemptAt: new Date() },
});

describe('durable work queued by SQL migrations', () => {
  it('picks up the actual SQL migration enqueue with database-default timestamps', async () => {
    const service = await prisma.service.create({ data: { type: 'sonarr', name: 'Native library', config: '{}' } });
    const sql = readFileSync(new URL('../prisma/migrations/20261030200000_post_migration_jobs/migration.sql', import.meta.url), 'utf8');
    await prisma.$executeRawUnsafe(sql.slice(sql.indexOf('INSERT OR IGNORE')));
    vi.setSystemTime(new Date('2035-01-01T00:00:00Z'));
    const execute = vi.fn().mockResolvedValue({ skipped: false });
    await runPostMigrationJobs(execute);
    expect(execute).toHaveBeenCalledExactlyOnceWith('full_sync');
    await prisma.service.delete({ where: { id: service.id } });
  });

  it('runs a migration job once and preserves its completion across runner restarts', async () => {
    await enqueue();
    const execute = vi.fn().mockResolvedValue({ skipped: false });
    await runPostMigrationJobs(execute);
    await runPostMigrationJobs(execute);
    expect(execute).toHaveBeenCalledExactlyOnceWith('full_sync');
    expect(await prisma.postMigrationJob.findUnique({ where: { key: 'refresh' } }))
      .toMatchObject({ attempts: 1, completedAt: new Date(), leaseToken: null, lastError: null });
  });

  it('retains failed work and retries after backoff, without storing provider secrets', async () => {
    await enqueue();
    const execute = vi.fn().mockRejectedValueOnce(new Error('https://host/?apikey=secret'))
      .mockResolvedValue({ skipped: false });
    await runPostMigrationJobs(execute);
    const failed = await prisma.postMigrationJob.findUniqueOrThrow({ where: { key: 'refresh' } });
    expect(failed.completedAt).toBeNull();
    expect(failed.lastError).not.toContain('secret');
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    await runPostMigrationJobs(execute);
    expect(execute).toHaveBeenCalledTimes(1);
    vi.setSystemTime(failed.nextAttemptAt);
    await runPostMigrationJobs(execute);
    expect(execute).toHaveBeenCalledTimes(2);
    expect((await prisma.postMigrationJob.findUniqueOrThrow({ where: { key: 'refresh' } })).completedAt).not.toBeNull();
  });

  it('does not mistake a busy scheduler for a successful migration job', async () => {
    await enqueue();
    await runPostMigrationJobs(vi.fn().mockResolvedValue({ skipped: true }));
    expect((await prisma.postMigrationJob.findUniqueOrThrow({ where: { key: 'refresh' } })).completedAt).toBeNull();
  });

  it('atomically claims work across concurrent runners', async () => {
    await enqueue();
    let finish!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    const execute = vi.fn(async () => { entered(); await blocked; return { skipped: false }; });
    const first = runPostMigrationJobs(execute);
    await started;
    await runPostMigrationJobs(execute);
    finish();
    await first;
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reclaims work after a crashed process lease expires', async () => {
    await enqueue();
    const expires = new Date(Date.now() + 300_000);
    await prisma.postMigrationJob.update({ where: { key: 'refresh' }, data: {
      leaseToken: 'dead-process', nextAttemptAt: expires, attempts: 1,
    } });
    const execute = vi.fn().mockResolvedValue({ skipped: false });
    await runPostMigrationJobs(execute);
    expect(execute).not.toHaveBeenCalled();
    vi.setSystemTime(expires);
    await runPostMigrationJobs(execute);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not complete a lease that has been reassigned to another worker', async () => {
    await enqueue();
    await runPostMigrationJobs(async () => {
      await prisma.postMigrationJob.update({ where: { key: 'refresh' }, data: { leaseToken: 'new-worker' } });
      return { skipped: false };
    });
    expect((await prisma.postMigrationJob.findUniqueOrThrow({ where: { key: 'refresh' } })).completedAt).toBeNull();
  });

  it('stops taking work when database maintenance begins', async () => {
    await enqueue();
    const execute = vi.fn();
    await runPostMigrationJobs(execute, () => true);
    expect(execute).not.toHaveBeenCalled();
  });
});
