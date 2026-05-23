import type { FastifyInstance } from 'fastify';
import { settingsRoutes } from './settings.js';
import { servicesRoutes } from './services.js';
import { folderRulesRoutes } from './folderRules.js';
import { usersRoutes } from './users.js';
import { logsRoutes } from './logs.js';
import { jobsRoutes } from './jobs.js';
import { syncRoutes } from './sync.js';
import { notificationsAdminRoutes } from './notifications.js';
import { qualityRoutes } from './quality.js';
import { dangerRoutes } from './danger.js';
import { rolesRoutes } from './roles.js';
import { keywordsRoutes } from './keywords.js';
import { blacklistRoutes } from './blacklist.js';
import { backupRoutes } from './backup.js';
import { homepageRoutes } from './homepage.js';
import { dashboardRoutes } from './dashboard.js';
import { plexAdminRoutes } from './plex.js';
import { authProvidersRoutes } from './authProviders.js';
import { setupChecklistRoutes } from './setupChecklist.js';
import { apiKeysAdminRoutes } from './apiKeys.js';
import { securityAdminRoutes } from './security.js';
import { importRoutes } from './import.js';
import { feedbackRoutes } from './feedback.js';
import { logEvent } from '../../utils/logEvent.js';

export async function adminRoutes(app: FastifyInstance) {
  await settingsRoutes(app);
  await servicesRoutes(app);
  await folderRulesRoutes(app);
  await usersRoutes(app);
  await logsRoutes(app);
  await jobsRoutes(app);
  await syncRoutes(app);
  await notificationsAdminRoutes(app);
  await qualityRoutes(app);
  await dangerRoutes(app);
  await rolesRoutes(app);
  await keywordsRoutes(app);
  await blacklistRoutes(app);
  await backupRoutes(app);
  await homepageRoutes(app);
  await dashboardRoutes(app);
  await plexAdminRoutes(app);
  await authProvidersRoutes(app);
  await setupChecklistRoutes(app);
  await apiKeysAdminRoutes(app);
  await securityAdminRoutes(app);
  await importRoutes(app);
  await feedbackRoutes(app);

  // Graceful restart — rate-limited + confirm body + actor logged.
  app.post('/restart', {
    config: { rateLimit: { max: 1, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['confirm'],
        properties: { confirm: { type: 'string', description: 'Must equal "RESTART"' } },
      },
    },
  }, async (request, reply) => {
    const { confirm } = request.body as { confirm: string };
    if (confirm !== 'RESTART') return reply.status(400).send({ error: 'RESTART_NOT_CONFIRMED' });
    const actor = request.user as { id: number } | undefined;
    logEvent('warn', 'Admin', `Server restart triggered by user ${actor?.id ?? 'unknown'}`);
    reply.send({ ok: true, message: 'Server restarting...' });
    setTimeout(() => process.exit(0), 500);
  });
}
