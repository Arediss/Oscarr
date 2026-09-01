import { prisma } from './prisma.js';
import type { AppSettings, Prisma } from '@prisma/client';
import { encryptSecretValue, decryptSecretValue } from './secrets.js';

// Single accessor for the AppSettings singleton (id:1). Replaces ~54 inline `where:{id:1}` sites.

/** `apiKey` is the instance-wide credential for the health check and the *arr webhooks — a
 *  bearer secret that used to sit in the database in plaintext. It is encrypted at rest and
 *  unwrapped here, so every existing caller keeps reading `settings.apiKey` unchanged. */
function withPlainApiKey<T extends AppSettings | null>(row: T): T {
  return row ? ({ ...row, apiKey: decryptSecretValue(row.apiKey) } as T) : row;
}

/** Read the AppSettings singleton, or null if it hasn't been created yet. */
export async function getAppSettings(): Promise<AppSettings | null> {
  return withPlainApiKey(await prisma.appSettings.findUnique({ where: { id: 1 } }));
}

/** Read the AppSettings singleton, creating it from defaults on first access. */
export async function ensureAppSettings(): Promise<AppSettings> {
  return withPlainApiKey(await prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }));
}

/** Parse AppSettings.instanceLanguages (a JSON array of locale codes) into a non-empty array,
 *  falling back to ['en'] on null / malformed / empty. Never throws. */
export function parseInstanceLanguages(raw: string | null | undefined): string[] {
  if (!raw) return ['en'];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === 'string')) return arr as string[];
  } catch { /* fall through to default */ }
  return ['en'];
}

/** Upsert the AppSettings singleton. The create branch is derived from the same partial, so a
 *  brand-new row can never silently drop a field. Callers pass already-normalised values. */
export async function patchAppSettings(data: Prisma.AppSettingsUncheckedUpdateInput): Promise<AppSettings> {
  const payload: Prisma.AppSettingsUncheckedUpdateInput = typeof data.apiKey === 'string'
    ? { ...data, apiKey: encryptSecretValue(data.apiKey) }
    : data;
  return withPlainApiKey(await prisma.appSettings.upsert({
    where: { id: 1 },
    update: payload,
    create: { id: 1, ...payload } as Prisma.AppSettingsUncheckedCreateInput,
  }));
}
