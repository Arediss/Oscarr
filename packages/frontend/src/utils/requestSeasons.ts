/** null/[] means the whole series; malformed legacy scopes must not imply that. */
export function parseRequestSeasons(raw: string | null): number[] | 'all' | 'unknown' {
  if (raw === null) return 'all';
  try {
    const seasons: unknown = JSON.parse(raw);
    if (!Array.isArray(seasons) || !seasons.every(s => Number.isInteger(s) && s > 0)) return 'unknown';
    return seasons.length ? [...new Set(seasons as number[])].sort((a, b) => a - b) : 'all';
  } catch {
    return 'unknown';
  }
}
