import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../utils/prisma.js';
import { runFullSync, runNewMediaSync } from './sync/index.js';
import { cleanupOrphanedRequests } from './requestCleanup.js';
import { retryFailedRequests } from './requestService.js';
import { getGenreBackdrops } from './tmdb.js';
import { syncMissingKeywords } from './sync/keywordSync.js';
import { runAutoBackup } from './backupService.js';
import { clearExpiredCache } from '../utils/cache.js';
import type { PluginEngine } from '../plugins/engine.js';
import { logEvent } from '../utils/logEvent.js';

/** Strip control characters (newlines, tabs, etc.) to prevent log injection */
function sanitize(input: string): string {
  return input.replaceAll(/[\r\n\t]/g, '');
}

// Map of job keys to their handler functions
const JOB_HANDLERS: Record<string, () => Promise<unknown>> = {
  new_media_sync: async () => runNewMediaSync(),
  full_sync: async () => runFullSync(),
  cleanup_orphans: async () => cleanupOrphanedRequests(),
  retry_failed_requests: async () => retryFailedRequests(),
  genre_backdrops_refresh: async () => getGenreBackdrops(),
  keyword_sync: async () => syncMissingKeywords(),
  auto_backup: async () => runAutoBackup(),
  cache_cleanup: async () => ({ removed: await clearExpiredCache() }),
};

// `label` is an i18n key resolved by the frontend; plugin jobs with free-text labels fall through.
const DEFAULT_JOBS = [
  { key: 'new_media_sync',        label: 'admin.jobs.labels.new_media_sync',        cronExpression: '*/15 * * * *', enabled: true },
  { key: 'full_sync',              label: 'admin.jobs.labels.full_sync',              cronExpression: '0 6 * * *',    enabled: true },
  { key: 'cleanup_orphans',        label: 'admin.jobs.labels.cleanup_orphans',        cronExpression: '0 3 * * *',    enabled: true },
  { key: 'retry_failed_requests',  label: 'admin.jobs.labels.retry_failed_requests',  cronExpression: '*/30 * * * *', enabled: true },
  { key: 'genre_backdrops_refresh', label: 'admin.jobs.labels.genre_backdrops_refresh', cronExpression: '0 4 * * *',   enabled: true },
  { key: 'keyword_sync',           label: 'admin.jobs.labels.keyword_sync',           cronExpression: '0 */1 * * *',  enabled: true },
  { key: 'auto_backup',            label: 'admin.jobs.labels.auto_backup',            cronExpression: '0 */6 * * *',  enabled: true },
  { key: 'cache_cleanup',          label: 'admin.jobs.labels.cache_cleanup',          cronExpression: '0 3 * * *',    enabled: true },
];

const activeTasks = new Map<string, ScheduledTask>();
const pluginJobKeys = new Set<string>(); // Track which job keys belong to plugins
// Per-key mutex — same job can't double-run (manual + cron tick collision).
const runningJobs = new Set<string>();
let _pluginEngine: PluginEngine | null = null;

export type RunJobOutcome =
  | { skipped: true; reason: 'already_running' | 'unknown_job' | 'plugin_disabled' }
  | { skipped: false; result: unknown };

async function seedJobs() {
  for (const job of DEFAULT_JOBS) {
    // Re-sync label so upgrades pick up the new i18n key; cron + enabled stay user-controlled.
    await prisma.cronJob.upsert({
      where: { key: job.key },
      update: { label: job.label },
      create: job,
    });
  }
}

async function runJob(key: string): Promise<RunJobOutcome> {
  // Resolve plugin handlers lazily so a hot-installed plugin's job runs without restart —
  // initScheduler's one-shot Object.assign would otherwise miss it until next boot.
  const handler = JOB_HANDLERS[key] ?? _pluginEngine?.getJobHandlers()[key];
  if (!handler) return { skipped: true, reason: 'unknown_job' };

  // Guard: skip plugin jobs if their plugin is disabled
  if (pluginJobKeys.has(key) && _pluginEngine) {
    const pluginList = _pluginEngine.getPluginList();
    const ownerPlugin = pluginList.find(p =>
      _pluginEngine!.getPlugin(p.id)?.manifest.hooks?.jobs?.some(j => j.key === key)
    );
    if (ownerPlugin && !ownerPlugin.enabled) {
      logEvent('debug', 'Job', `Skipping job "${sanitize(key)}" — plugin "${ownerPlugin.id}" is disabled`);
      return { skipped: true, reason: 'plugin_disabled' };
    }
  }

  if (runningJobs.has(key)) {
    logEvent('debug', 'Job', `Job "${sanitize(key)}" already running, skipping concurrent trigger`);
    return { skipped: true, reason: 'already_running' };
  }
  runningJobs.add(key);

  const wasFirstSync = !(await hasCompletedFirstSync());

  const start = Date.now();
  try {
    const result = await handler();
    const duration = Date.now() - start;
    await prisma.cronJob.update({
      where: { key },
      data: {
        lastRunAt: new Date(),
        lastStatus: 'success',
        lastDuration: duration,
        lastResult: JSON.stringify(result ?? null),
      },
    });
    logEvent('info', 'Job', `Job "${sanitize(key)}" completed in ${duration}ms`);

    // After the first successful full sync, start all cron schedules
    if (wasFirstSync && key === 'full_sync' && activeTasks.size === 0) {
      logEvent('debug', 'Job', 'First full sync done — starting cron schedules');
      await startAllJobs();
    }

    return { skipped: false, result };
  } catch (err) {
    const duration = Date.now() - start;
    await prisma.cronJob.update({
      where: { key },
      data: {
        lastRunAt: new Date(),
        lastStatus: 'error',
        lastDuration: duration,
        lastResult: JSON.stringify({ error: String(err) }),
      },
    });
    logEvent('error', 'Job', `Job "${sanitize(key)}" failed`, err);
    throw err;
  } finally {
    runningJobs.delete(key);
  }
}

function scheduleJob(key: string, cronExpression: string) {
  // Stop existing task if any
  const existing = activeTasks.get(key);
  if (existing) {
    existing.stop();
    activeTasks.delete(key);
  }

  if (!cron.validate(cronExpression)) {
    logEvent('debug', 'Job', `Invalid cron expression for "${sanitize(key)}": ${sanitize(cronExpression)}`);
    return;
  }

  // runJob already logs+writes lastStatus on its own catch, but a synchronous throw before
  // that catch (or a logEvent failure inside it) would otherwise vanish into the cron callback.
  const task = cron.schedule(cronExpression, () => {
    runJob(key).catch((err) => {
      logEvent('error', 'Job', `Cron tick for "${sanitize(key)}" rejected outside runJob: ${String(err)}`);
    });
  });
  activeTasks.set(key, task);
  logEvent('debug', 'Job', `Job "${sanitize(key)}" scheduled: ${sanitize(cronExpression)}`);
}

/** Check if a first full sync has been completed */
async function hasCompletedFirstSync(): Promise<boolean> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  return !!(settings?.lastRadarrSync || settings?.lastSonarrSync);
}

/** Start all enabled cron schedules */
async function startAllJobs() {
  const jobs = await prisma.cronJob.findMany();
  for (const job of jobs) {
    if (job.enabled) {
      scheduleJob(job.key, job.cronExpression);
    }
  }
  logEvent('debug', 'Job', `${jobs.filter((j) => j.enabled).length}/${jobs.length} jobs active`);
}

export async function initScheduler(pluginEngine?: PluginEngine) {
  // Register plugin job handlers and seed their definitions
  if (pluginEngine) {
    _pluginEngine = pluginEngine;
    const pluginHandlers = pluginEngine.getJobHandlers();
    Object.assign(JOB_HANDLERS, pluginHandlers);

    const pluginJobDefs = pluginEngine.getJobDefs();
    for (const job of pluginJobDefs) {
      pluginJobKeys.add(job.key);
      await prisma.cronJob.upsert({
        where: { key: job.key },
        update: {},
        create: { key: job.key, label: job.label, cronExpression: job.cron, enabled: true },
      });
    }
  }

  await seedJobs();

  // Only start cron schedules if a first full sync has been done
  if (await hasCompletedFirstSync()) {
    await startAllJobs();
  } else {
    logEvent('debug', 'Job', 'Jobs seeded but not started — waiting for first full sync');
  }
}

export async function updateJobSchedule(key: string, cronExpression: string, enabled: boolean) {
  const existing = activeTasks.get(key);
  if (existing) {
    existing.stop();
    activeTasks.delete(key);
  }

  if (enabled && cron.validate(cronExpression)) {
    scheduleJob(key, cronExpression);
  }
}

export async function triggerJob(key: string): Promise<RunJobOutcome> {
  return runJob(key);
}

/** Register a plugin's job definitions after a hot install (loadSingle). Upserts CronJob rows
 *  and schedules cron tasks; without this, manual triggers and cron ticks would only see the
 *  plugin's jobs after the next process restart. */
export async function registerPluginJobs(jobs: { key: string; label: string; cron: string }[]): Promise<void> {
  for (const job of jobs) {
    pluginJobKeys.add(job.key);
    const row = await prisma.cronJob.upsert({
      where: { key: job.key },
      update: {},
      create: { key: job.key, label: job.label, cronExpression: job.cron, enabled: true },
    });
    if (row.enabled) scheduleJob(job.key, row.cronExpression);
  }
}

/** True when `key` is currently mid-run (manual or cron-triggered). Read-only — for status APIs. */
export function isJobRunning(key: string): boolean {
  return runningJobs.has(key);
}

