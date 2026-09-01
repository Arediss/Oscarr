import './env.js';
import { loadMasterKeyOrExit } from './utils/secrets.js';
import { assertJwtSecretOrExit, assertSetupSecretOrExit } from './utils/envSecret.js';
loadMasterKeyOrExit();
assertJwtSecretOrExit();
import Fastify from 'fastify';
import { prisma } from './utils/prisma.js';
import { runMigrateDeploy } from './utils/prismaMigrate.js';
import { resolveTrustProxy } from './utils/trustProxy.js';
import { isInstalled, loadInstallState } from './utils/install.js';
import { logEvent } from './utils/logEvent.js';
import { registerSecurity } from './bootstrap/security.js';
import { registerDocs } from './bootstrap/docs.js';
import { registerRoutes } from './bootstrap/routes.js';
import { registerPlugins } from './bootstrap/plugins.js';
import { registerStatic } from './bootstrap/static.js';
import { initNotifications, startScheduler } from './bootstrap/jobs.js';
import { refreshVerboseRequestLogFlag, registerVerboseRequestLog } from './utils/verboseRequestLog.js';
import { runLegacySupportExport } from './services/supportLegacyExport.js';
import { adoptLegacyEmailProviderConfig } from './services/mailer.js';
import { encryptSecretsAtRest } from './services/secretsMigration.js';

// Process-level guards: log the error to AppLog (so an admin can share it from the Logs tab)
// then exit hard — a process that's already thrown an unhandled exception is in undefined state
// (half-open transactions, corrupted in-memory cache), and the supervisor (Docker/pm2) will
// respawn us cleanly. Keeping a zombie alive silently corrupts user data.
const exitAfterLog = (label: string, err: Error) => {
  logEvent('error', label, err.message, err)
    .catch((logErr) => console.error(`[${label}] logEvent failed`, logErr))
    .finally(() => process.exit(1));
};
process.on('uncaughtException', (err) => exitAfterLog('UncaughtException', err));
process.on('unhandledRejection', (reason) => {
  exitAfterLog('UnhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);
if (trustProxy === false && process.env.NODE_ENV === 'production' && !process.env.TRUST_PROXY) {
  process.stderr.write(
    '[TRUST_PROXY] Not set — X-Forwarded-* headers are ignored and rate limits key on the direct\n'
    + '              peer address. Correct when Oscarr is exposed directly. Behind a reverse proxy,\n'
    + '              set TRUST_PROXY to the proxy IP/CIDR (e.g. TRUST_PROXY=172.18.0.0/16) so client\n'
    + '              IPs are read correctly.\n',
  );
}
const app = Fastify({
  logger: {
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.apiKey',
        '*.apikey',
        '*.token',
        '*.clientSecret',
        '*.client_secret',
        '*.refreshToken',
        '*.accessToken',
      ],
      censor: '[REDACTED]',
    },
  },
  trustProxy,
});

/** Always apply pending Prisma migrations at boot, then drop the connection the CLI raced with. */
async function ensureMigrated() {
  runMigrateDeploy();
  await prisma.$disconnect();
}

async function start() {
  loadInstallState();
  assertSetupSecretOrExit(isInstalled());
  // Export legacy SupportTicket/TicketMessage rows before the drop migration removes them.
  runLegacySupportExport();
  await ensureMigrated();
  // Runs after migrations so MailConfig exists, and before routes so the admin panel never
  // shows the pre-0.8.9 split configuration.
  await adoptLegacyEmailProviderConfig().catch((err) => logEvent('warn', 'Mail', `Legacy mail config adoption skipped: ${String(err)}`));
  // Runs before routes so no request can read — or rewrite — a credential still in plaintext.
  await encryptSecretsAtRest().catch((err) => logEvent('error', 'Security', `Secret encryption sweep failed: ${String(err)}`));
  await refreshVerboseRequestLogFlag();
  await registerSecurity(app);
  registerVerboseRequestLog(app);
  await registerDocs(app);
  await registerRoutes(app);
  initNotifications();
  await registerPlugins(app);
  await registerStatic(app);

  const port = Number.parseInt(process.env.PORT || '3001', 10);
  if (Number.isNaN(port)) throw new Error('PORT environment variable must be a valid number');
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ port }, 'Oscarr API listening');

  await startScheduler();
}

start().catch((err) => {
  app.log.fatal({ err }, 'Boot failed');
  process.exit(1);
});

export type App = typeof app;
