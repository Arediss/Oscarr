import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { BACKEND_ROOT } from './paths.js';

/**
 * Apply pending Prisma migrations to whatever database is on disk right now. Idempotent —
 * zero-ops when it is already current. Throws when `migrate deploy` exits non-zero.
 *
 * Resolves the prisma CLI through Node's module resolution so it works both in dev (npm
 * workspaces hoist to <root>/node_modules) and in the prod image (deps live under
 * packages/backend/node_modules) — without depending on `npx`.
 *
 * Does NOT touch the Prisma client connection: boot disconnects afterwards, restore is already
 * disconnected. Callers own their own connection lifecycle.
 */
export function runMigrateDeploy(): void {
  const requireFn = createRequire(import.meta.url);
  const pkgPath = requireFn.resolve('prisma/package.json');
  const pkg = requireFn('prisma/package.json') as { bin: Record<string, string> };
  const prismaCli = join(dirname(pkgPath), pkg.bin.prisma);
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: BACKEND_ROOT,
    stdio: 'inherit',
  });
}
