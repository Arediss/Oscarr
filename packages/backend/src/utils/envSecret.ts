import crypto from 'node:crypto';

/**
 * Boot-time strength checks for JWT_SECRET / SETUP_SECRET. The encryption master key has its own
 * in ./secrets.ts. Tiered on purpose: failing every secret under 32 chars would brick existing
 * installs on upgrade.
 */

const MIN_FATAL_LENGTH = 16;
const MIN_RECOMMENDED_LENGTH = 32;

/** Matched after lowercasing and stripping separators, so `Change-Me` and `change_me` both hit. */
const PLACEHOLDER_PREFIXES = [
  'changeme',
  'change',
  'yourrandom',
  'your',
  'replaceme',
  'todo',
  'example',
  'secret',
  'password',
  'test',
];

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[\s_\-.]/g, '');
  return PLACEHOLDER_PREFIXES.some((p) => normalized.startsWith(p));
}

function printFatal(name: string, reason: string): void {
  const suggested = crypto.randomBytes(32).toString('base64url');
  const line = '━'.repeat(70);
  process.stderr.write(`\n${line}\n Oscarr — insecure ${name}\n${line}\n\n`);
  process.stderr.write(` ${reason}.\n\n Replace it with a fresh random value:\n\n`);
  process.stderr.write(`   ${name}=${suggested}\n\n`);
  process.stderr.write(' • Docker:     add `-e ' + name + '=...` (or env_file in compose)\n');
  process.stderr.write(' • Bare-metal: add to your .env file\n\n');
  if (name === 'JWT_SECRET') {
    process.stderr.write(' Changing it signs out every user (sessions are stateless) and invalidates the\n');
    process.stderr.write(' integrity signature of existing backups, whose HMAC key derives from this value.\n');
    process.stderr.write(' No data is lost: a backup archive still holds the database in full, and its\n');
    process.stderr.write(' manifest can be restored after removing the stale `integrity` field.\n');
  }
  process.stderr.write(`${line}\n\n`);
}

/** 'enforce' refuses to boot on a weak value; 'advise' only warns. */
type Enforcement = 'enforce' | 'advise';

function checkSecret(name: string, raw: string | undefined, enforcement: Enforcement): void {
  const value = raw?.trim() ?? '';

  const problem =
    !value ? `${name} is not set`
    : isPlaceholder(value) ? `${name} is still set to a placeholder value — it is public knowledge`
    : value.length < MIN_FATAL_LENGTH ? `${name} is ${value.length} characters — too short to resist offline brute force`
    : null;

  if (problem) {
    if (enforcement === 'enforce') {
      printFatal(name, problem);
      process.exit(1);
    }
    // Absent + inert isn't worth a line on every boot; weak-but-present is.
    if (value) process.stderr.write(`[${name}] Warning: ${problem}.\n`);
    return;
  }

  if (value.length < MIN_RECOMMENDED_LENGTH) {
    process.stderr.write(
      `[${name}] Warning: ${value.length} characters. ${MIN_RECOMMENDED_LENGTH}+ is recommended.\n`
    );
  }
}

/** Call before registering @fastify/jwt. */
export function assertJwtSecretOrExit(): void {
  checkSecret('JWT_SECRET', process.env.JWT_SECRET, 'enforce');
}

/** Advisory once installed: the wizard is already closed, so a weak value guards nothing and
 *  refusing to boot would turn an upgrade into an outage. Call after `loadInstallState()`. */
export function assertSetupSecretOrExit(installed: boolean): void {
  checkSecret('SETUP_SECRET', process.env.SETUP_SECRET, installed ? 'advise' : 'enforce');
}
