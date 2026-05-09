import './env.js';
import { loadMasterKeyOrExit } from './utils/secrets.js';
loadMasterKeyOrExit();
import Fastify from 'fastify';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { prisma } from './utils/prisma.js';
import { BACKEND_ROOT } from './utils/paths.js';
import { loadInstallState } from './utils/install.js';
import { logEvent } from './utils/logEvent.js';
import { registerSecurity } from './bootstrap/security.js';
import { registerDocs } from './bootstrap/docs.js';
import { registerRoutes } from './bootstrap/routes.js';
import { registerPlugins } from './bootstrap/plugins.js';
import { registerStatic } from './bootstrap/static.js';
import { initNotifications, startScheduler } from './bootstrap/jobs.js';
import { refreshVerboseRequestLogFlag, registerVerboseRequestLog } from './utils/verboseRequestLog.js';
import { runLegacySupportExport } from './services/supportLegacyExport.js';

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

// Default on — set TRUST_PROXY=false only when exposed directly (no reverse proxy).
const trustProxy = process.env.TRUST_PROXY !== 'false';
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

/** Always apply pending Prisma migrations at boot. Idempotent — zero-ops when the DB is
 *  already current. Resolves the prisma CLI via Node's module resolution so it works both in
 *  dev (npm workspaces hoist to <root>/node_modules) and in the prod image (deps live under
 *  packages/backend/node_modules) — without depending on `npx`. */
async function ensureMigrated() {
  const requireFn = createRequire(import.meta.url);
  const pkgPath = requireFn.resolve('prisma/package.json');
  const pkg = requireFn('prisma/package.json') as { bin: Record<string, string> };
  const prismaCli = join(dirname(pkgPath), pkg.bin.prisma);
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: BACKEND_ROOT,
    stdio: 'inherit',
  });
  await prisma.$disconnect();
}

async function start() {
  loadInstallState();
  // Export legacy SupportTicket/TicketMessage rows before the drop migration removes them.
  runLegacySupportExport();
  await ensureMigrated();
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
