import { prisma } from './prisma.js';
import type { AppSettings, Prisma } from '@prisma/client';

// Single accessor for the AppSettings singleton (id:1). Replaces ~54 inline `where:{id:1}` sites.

/** Read the AppSettings singleton, or null if it hasn't been created yet. */
export function getAppSettings(): Promise<AppSettings | null> {
  return prisma.appSettings.findUnique({ where: { id: 1 } });
}

/** Read the AppSettings singleton, creating it from defaults on first access. */
export async function ensureAppSettings(): Promise<AppSettings> {
  return prisma.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
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
export function patchAppSettings(data: Prisma.AppSettingsUncheckedUpdateInput): Promise<AppSettings> {
  return prisma.appSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data } as Prisma.AppSettingsUncheckedCreateInput,
  });
}
