import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { triggerJob, updateJobSchedule, isJobRunning } from '../../services/scheduler.js';
import { logEvent } from '../../utils/logEvent.js';
import nodeSchedule from 'node-cron';

export async function jobsRoutes(app: FastifyInstance) {
  // === CRON JOBS ===

  app.get('/jobs', async (request, reply) => {
    const jobs = await prisma.cronJob.findMany({ orderBy: { key: 'asc' } });
    return jobs.map((j) => ({ ...j, running: isJobRunning(j.key) }));
  });

  app.put('/jobs/:key', {
    schema: {
      params: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string', description: 'Cron job key identifier' },
        },
      },
      body: {
        type: 'object',
        properties: {
          cronExpression: { type: 'string', description: 'Cron expression for scheduling' },
          enabled: { type: 'boolean', description: 'Enable or disable the job' },
        },
      },
    },
  }, async (request, reply) => {

    const { key } = request.params as { key: string };
    const { cronExpression, enabled } = request.body as { cronExpression?: string; enabled?: boolean };

    if (cronExpression && !nodeSchedule.validate(cronExpression)) {
      return reply.status(400).send({ error: 'Invalid CRON expression' });
    }

    const job = await prisma.cronJob.update({
      where: { key },
      data: {
        ...(cronExpression !== undefined ? { cronExpression } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });

    await updateJobSchedule(key, job.cronExpression, job.enabled);
    return job;
  });

  app.post('/jobs/:key/run', {
    schema: {
      params: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string', description: 'Cron job key identifier' },
        },
      },
    },
  }, async (request, reply) => {

    const { key } = request.params as { key: string };
    if (isJobRunning(key)) {
      return reply.status(409).send({ error: 'already_running', message: `Job "${key}" is already running` });
    }
    const job = await prisma.cronJob.findUnique({ where: { key }, select: { key: true } });
    if (!job) return reply.status(404).send({ error: 'unknown_job' });
    // Fire-and-forget — front polls /jobs for lastStatus/lastResult.
    triggerJob(key).then(async (outcome) => {
      // A skipped launch never reaches the scheduler's completion write. Advance its state
      // explicitly so the client can stop waiting. Do not overwrite a concurrent real run.
      if (outcome.skipped && outcome.reason !== 'already_running' && outcome.reason !== 'maintenance') {
        await prisma.cronJob.update({
          where: { key },
          data: { lastRunAt: new Date(), lastStatus: 'error', lastDuration: 0, lastResult: JSON.stringify(outcome) },
        });
      }
    }).catch((err) => {
      logEvent('error', 'Job', `Background job "${key}" failed: ${String(err)}`);
    });
    return reply.status(202).send({ ok: true, started: true });
  });
}
