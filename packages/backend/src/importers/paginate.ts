/** One page as Overseerr/Jellyseerr return it. */
export interface PageEnvelope<T> {
  results: T[];
  pageInfo?: unknown;
}

export interface PaginationLimits {
  pageSize: number;
  maxRows: number;
  maxPages: number;
}

/**
 * Defaults sized for a real instance, not for a demo.
 *
 * The previous bounds — a 5-minute whole-import deadline and 20 000 rows — were written without
 * being measured against the library they had to survive, and either would have aborted the
 * migration outright. A source that is merely large should finish; only a runaway should stop.
 *
 * There is deliberately no stall ceiling here. A source that goes quiet is already handled one
 * level up, where every request carries its own abort (`REQUEST_TIMEOUT_MS` in seerr.ts): a page
 * can never take longer than that, so a stall ceiling above it could never fire, and one below it
 * would just be a second, quieter copy of the same timeout. Rows and pages are what bound a source
 * that answers promptly and never ends.
 *
 * Both values are overridable per deployment (see `limitsFromEnv`), so an unusually large instance
 * is a config change and not a patch.
 */
export const DEFAULT_PAGINATION_LIMITS: PaginationLimits = {
  pageSize: 100,
  maxRows: 200_000,
  maxPages: 5_000,
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Read the overridable ceilings from the environment, falling back to the defaults. */
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): PaginationLimits {
  return {
    pageSize: DEFAULT_PAGINATION_LIMITS.pageSize,
    maxRows: positiveInt(env.SEERR_IMPORT_MAX_ROWS, DEFAULT_PAGINATION_LIMITS.maxRows),
    maxPages: positiveInt(env.SEERR_IMPORT_MAX_PAGES, DEFAULT_PAGINATION_LIMITS.maxPages),
  };
}

/**
 * Walk a paged Seerr endpoint to exhaustion, under two ceilings: rows and pages. Each error names
 * how much had already been fetched — on migration day, "it stopped at 18 400 rows" is the
 * difference between a fix and a guess.
 */
export async function paginate<T>(
  fetchPage: (skip: number, take: number) => Promise<PageEnvelope<T>>,
  limits: PaginationLimits,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  let skip = 0;

  for (let page = 0; page < limits.maxPages; page++) {
    const received = await fetchPage(skip, limits.pageSize);

    const rows = received?.results ?? [];
    out.push(...rows);
    if (rows.length < limits.pageSize) return out;

    if (out.length >= limits.maxRows) {
      throw new Error(`Seerr ${label} returned more than ${limits.maxRows} rows — refusing to keep paging`);
    }
    skip += limits.pageSize;
  }

  throw new Error(`Seerr ${label} returned more than ${limits.maxPages} pages — refusing to keep paging`);
}
