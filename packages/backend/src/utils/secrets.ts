import crypto from 'node:crypto';

/**
 * Encryption-at-rest for credentials stored in `Service.config` (and any future table that
 * holds secrets). All sensitive values are AES-256-GCM encrypted with a key derived from
 * `OSCARR_SECRET_KEY` (env var, mandatory).
 *
 * Storage format per field: `enc:v1:<base64-iv>.<base64-ciphertext>.<base64-tag>`. The
 * `enc:v1:` prefix lets readers detect encrypted vs plaintext without parsing — same column
 * can hold either during the migration window. Plaintext fields surface in the security banner
 * so the admin can re-enter them.
 */
const ENC_PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** Field-name convention. Keys matching this regex are treated as secrets and encrypted on
 *  write / decrypted on read. Url, machineId, etc. stay plaintext so admins can debug services
 *  without unlocking. */
const SENSITIVE_KEY_RE = /(^|_)(key|token|secret|password|apikey)s?$/i;

let _serviceConfigKey: Buffer | null = null;

function deriveSubKey(master: Buffer, info: string): Buffer {
  // HKDF lets us split the master into named sub-keys (services-config, future-other-table…)
  // so a single master compromise doesn't reuse the same byte-stream across purposes.
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info), KEY_BYTES));
}

function printFatalKeyMessage(reason: string): void {
  const suggested = crypto.randomBytes(KEY_BYTES).toString('hex');
  const line = '━'.repeat(70);
  process.stderr.write(`\n${line}\n Oscarr — secret key required\n${line}\n\n`);
  process.stderr.write(` ${reason}.\n\n Add this to your environment:\n\n`);
  process.stderr.write(`   OSCARR_SECRET_KEY=${suggested}\n\n`);
  process.stderr.write(' • Docker:     add `-e OSCARR_SECRET_KEY=...` (or env_file in compose)\n');
  process.stderr.write(' • Bare-metal: add to your .env file\n\n');
  process.stderr.write(' Treat this key like a password. Lose it = stored credentials become\n');
  process.stderr.write(' unrecoverable and need to be re-entered.\n');
  process.stderr.write(`${line}\n\n`);
}

/** Load the master key from env. Exits the process with a friendly message + a freshly
 *  generated key suggestion when missing or malformed. Must be called once at boot before
 *  anything that touches Service.config. */
export function loadMasterKeyOrExit(): void {
  const raw = process.env.OSCARR_SECRET_KEY?.trim();
  if (!raw) {
    printFatalKeyMessage('OSCARR_SECRET_KEY is not set');
    process.exit(1);
  }
  let master: Buffer;
  try {
    master = Buffer.from(raw, 'hex');
  } catch {
    printFatalKeyMessage('OSCARR_SECRET_KEY is not valid hex');
    process.exit(1);
  }
  if (master.length !== KEY_BYTES) {
    printFatalKeyMessage(`OSCARR_SECRET_KEY must be ${KEY_BYTES * 2} hex characters (got ${master.length * 2})`);
    process.exit(1);
  }
  _serviceConfigKey = deriveSubKey(master, 'oscarr.service-config.v1');
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

export function encryptField(plain: string): string {
  if (!_serviceConfigKey) throw new Error('Master key not loaded — call loadMasterKeyOrExit() first');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, _serviceConfigKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}.${ciphertext.toString('base64')}.${tag.toString('base64')}`;
}

export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  if (!_serviceConfigKey) throw new Error('Master key not loaded — call loadMasterKeyOrExit() first');
  const parts = stored.slice(ENC_PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('Encrypted payload malformed');
  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, _serviceConfigKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Encrypt every sensitive field that isn't already encrypted. Idempotent — fields already
 *  carrying the `enc:v1:` prefix are passed through. */
export function encryptServiceConfig(config: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || !value || isEncrypted(value) || !isSensitiveKey(key)) {
      out[key] = value;
      continue;
    }
    out[key] = encryptField(value);
  }
  return out;
}

/** Decrypt every `enc:v1:`-prefixed field. Plaintext fields pass through unchanged so legacy
 *  rows still work and the security banner can flag them. Decryption errors collapse to an
 *  empty string so admin forms don't leak raw ciphertext into password inputs — the matching
 *  `hasUndecryptableSecret` helper surfaces these rows in the security banner so the admin
 *  re-enters them. Triggers in practice when restoring a backup encrypted with a different
 *  `OSCARR_SECRET_KEY` (cross-env DB clone, key rotation, lost key). */
export function decryptServiceConfig(config: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || !isEncrypted(value)) {
      out[key] = value;
      continue;
    }
    try {
      out[key] = decryptField(value);
    } catch (err) {
      console.error(`[secrets] decrypt failed for key "${key}":`, (err as Error).message);
      out[key] = '';
    }
  }
  return out;
}

/** True when any sensitive `enc:v1:`-prefixed field can't be decrypted with the loaded master
 *  key. Used by the security banner to flag services that survived a cross-env DB import or
 *  a master-key rotation — the admin must re-enter the credential to make the service work
 *  again under the new key. */
export function hasUndecryptableSecret(config: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(config)) {
    if (!isSensitiveKey(key) || typeof value !== 'string' || !isEncrypted(value)) continue;
    try {
      decryptField(value);
    } catch {
      return true;
    }
  }
  return false;
}

/** True when any sensitive field in this config is still stored in plaintext. Drives the
 *  "re-enter your credentials" banner in the admin panel. */
export function hasPlaintextSecret(config: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(config)) {
    if (isSensitiveKey(key) && typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
      return true;
    }
  }
  return false;
}
