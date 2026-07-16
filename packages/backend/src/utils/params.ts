export function parseId(value: string): number | null {
  const id = Number.parseInt(value, 10);
  return Number.isNaN(id) || id < 1 ? null : id;
}

export function parsePage(value?: string): number {
  const page = Number.parseInt(value || '1', 10);
  return page > 0 ? page : 1;
}

/** Clamp a query int to [min,max], falling back when missing/NaN. Generic — usable by any route. */
export function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export const VALID_MEDIA_TYPES: readonly string[] = ['movie', 'tv'];
