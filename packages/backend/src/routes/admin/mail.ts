import type { FastifyInstance } from 'fastify';
import {
  getMailConfig, redactMailConfig, saveMailConfig, testMailConfig, type MailConfig,
} from '../../services/mailer.js';
import { logEvent } from '../../utils/logEvent.js';

/** Mail transport administration. Secrets are write-only over this API: the GET reports whether one
 *  is on file, never its value, and the PUT keeps the stored secret when the field is omitted. */
export async function mailAdminRoutes(app: FastifyInstance) {
  app.get('/mail', async () => redactMailConfig(await getMailConfig()));

  app.put('/mail', {
    schema: {
      body: {
        type: 'object' as const,
        properties: {
          enabled: { type: 'boolean' },
          transport: { type: 'string', enum: ['smtp', 'resend'] },
          host: { type: 'string' },
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          secure: { type: 'boolean' },
          user: { type: 'string' },
          password: { type: 'string' },
          apiKey: { type: 'string' },
          fromEmail: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const current = await getMailConfig();
    // Env-provided config is the operator's, pinned in their compose file. Silently persisting a
    // panel edit that the env would keep overriding is worse than refusing it.
    if (current.fromEnv) {
      return reply.status(409).send({ error: 'MAIL_CONFIGURED_BY_ENV' });
    }
    await saveMailConfig(request.body as Parameters<typeof saveMailConfig>[0]);
    logEvent('info', 'Mail', 'Mail transport configuration updated');
    return redactMailConfig(await getMailConfig());
  });

  /** Sends through the submitted config, falling back to what is stored for any omitted field, so
   *  the admin can verify credentials before committing them. */
  app.post('/mail/test', {
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object' as const,
        required: ['to'],
        properties: {
          to: { type: 'string' },
          transport: { type: 'string', enum: ['smtp', 'resend'] },
          host: { type: 'string' },
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          secure: { type: 'boolean' },
          user: { type: 'string' },
          password: { type: 'string' },
          apiKey: { type: 'string' },
          fromEmail: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body as Partial<MailConfig> & { to: string };
    const stored = await getMailConfig();
    const candidate: MailConfig = {
      ...stored,
      ...(body.transport !== undefined && { transport: body.transport }),
      ...(body.host !== undefined && { host: body.host }),
      ...(body.port !== undefined && { port: body.port }),
      ...(body.secure !== undefined && { secure: body.secure }),
      ...(body.user !== undefined && { user: body.user }),
      ...(body.fromEmail !== undefined && { fromEmail: body.fromEmail }),
      // Empty means "use what is stored" — the panel sends blanks for untouched secret fields.
      ...(body.password ? { password: body.password } : {}),
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
    };

    try {
      await testMailConfig(candidate, body.to);
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message;
      logEvent('warn', 'Mail', `Mail test failed: ${message}`);
      return reply.status(400).send({ error: 'MAIL_TEST_FAILED', message });
    }
  });
}
