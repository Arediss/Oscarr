import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { beginMaintenance, endMaintenance } from '../src/utils/maintenance.js';

const edge = vi.hoisted(() => ({ full: vi.fn(), incremental: vi.fn() }));
vi.mock('../src/services/sync/index.js', () => ({ runFullSync: edge.full, runNewMediaSync: edge.incremental }));
vi.mock('../src/utils/appSettings.js', async original => ({
  ...await original<typeof import('../src/utils/appSettings.js')>(), getAppSettings: vi.fn(async () => null),
}));
vi.mock('node-cron', () => ({ default: { validate: () => true, schedule: () => ({ stop: vi.fn() }) } }));
vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));
const scheduler = await import('../src/services/scheduler.js');
const idle = () => vi.waitFor(() => expect(scheduler.runningJobKeys()).toEqual([]));

beforeEach(async () => {
  vi.clearAllMocks();
  endMaintenance();
  await prisma.postMigrationJob.deleteMany();
  await prisma.cronJob.deleteMany();
  edge.full.mockResolvedValue({ refreshed: true });
  edge.incremental.mockResolvedValue({});
});
afterEach(async () => {
  scheduler.stopAllJobs();
  endMaintenance();
  await idle();
});

it('executes queued upgrades even before first sync and with the daily cron disabled, without replaying them on restart', async () => {
  await prisma.cronJob.create({ data: { key: 'full_sync', label: 'Full', enabled: false } });
  await prisma.postMigrationJob.create({ data: { key: 'upgrade', jobKey: 'full_sync' } });
  await scheduler.initScheduler();
  await idle();
  expect(edge.full).toHaveBeenCalledTimes(1);
  expect(await prisma.cronJob.findUnique({ where: { key: 'full_sync' } })).toMatchObject({ enabled: false, lastStatus: 'success' });
  expect((await prisma.postMigrationJob.findUniqueOrThrow({ where: { key: 'upgrade' } })).completedAt).not.toBeNull();
  scheduler.stopAllJobs();
  await scheduler.initScheduler();
  await idle();
  expect(edge.full).toHaveBeenCalledTimes(1);
});

it('does not start an automatic full scan on a fresh installation with no queued upgrade', async () => {
  await scheduler.initScheduler();
  await idle();
  expect(edge.full).not.toHaveBeenCalled();
});

it('retains failed upgrade work and exposes the failed full sync through the existing jobs screen', async () => {
  await prisma.postMigrationJob.create({ data: { key: 'upgrade', jobKey: 'full_sync' } });
  edge.full.mockRejectedValue(new Error('Full sync incomplete: sonarr=1'));
  await scheduler.initScheduler();
  await idle();
  expect(await prisma.cronJob.findUnique({ where: { key: 'full_sync' } })).toMatchObject({ lastStatus: 'error' });
  expect(await prisma.postMigrationJob.findUnique({ where: { key: 'upgrade' } })).toMatchObject({ completedAt: null, attempts: 1 });
});

it('prevents an incremental sync or another full sync from racing a full scan', async () => {
  await scheduler.initScheduler();
  await idle();
  let finish!: () => void;
  edge.full.mockImplementation(() => new Promise(resolve => { finish = () => resolve({}); }));
  const scan = scheduler.triggerJob('full_sync');
  await vi.waitFor(() => expect(edge.full).toHaveBeenCalled());
  try {
    expect(await scheduler.triggerJob('new_media_sync')).toEqual({ skipped: true, reason: 'already_running' });
    expect(await scheduler.triggerJob('full_sync')).toEqual({ skipped: true, reason: 'already_running' });
    expect(edge.incremental).not.toHaveBeenCalled();
  } finally { finish(); await scan; }
});

it('rejects a late manual trigger during database maintenance before any database access', async () => {
  beginMaintenance('Restore');
  const query = vi.spyOn(prisma.cronJob, 'findUnique');
  try {
    expect(await scheduler.triggerJob('full_sync')).toEqual({ skipped: true, reason: 'maintenance' });
    expect(edge.full).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  } finally { query.mockRestore(); }
});
