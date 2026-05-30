import type { Availability } from '@oscarr/shared';
import { prisma } from '../utils/prisma.js';

interface MediaRow {
  tmdbId: number;
  mediaType: string;
  statusCategory: string;
}
interface RequestRow {
  id: number;
  status: string;
}

/** Sole builder of the wire Availability object. BLACKLISTED is the only Oscarr-side override. */
export function buildAvailability(
  media: MediaRow,
  userRequest: RequestRow | null,
  blacklistedKeys: ReadonlySet<string>,
): Availability {
  const key = `${media.mediaType}:${media.tmdbId}`;
  const statusCategory = blacklistedKeys.has(key)
    ? 'BLACKLISTED'
    : (media.statusCategory as Availability['statusCategory']);
  return {
    statusCategory,
    requestStatus: (userRequest?.status as Availability['requestStatus']) ?? null,
    requestId: userRequest?.id ?? null,
  };
}

/** Loads blacklisted ${mediaType}:${tmdbId} keys for a list of media in one query. */
export async function loadBlacklistedKeys(
  items: { tmdbId: number; mediaType: string }[],
): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  const rows = await prisma.blacklistedMedia.findMany({
    where: { OR: items.map((i) => ({ tmdbId: i.tmdbId, mediaType: i.mediaType })) },
    select: { tmdbId: true, mediaType: true },
  });
  return new Set(rows.map((r) => `${r.mediaType}:${r.tmdbId}`));
}
