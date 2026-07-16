import { prisma } from '../utils/prisma.js';
import type { Prisma } from '@prisma/client';

// Shared scaffolding for the Seerr-compat routes (pagination, request-count, include graph).

/** Clamp a query int to [min,max], falling back when missing/NaN. */
export function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Overseerr-style pageInfo envelope. MAX_TAKE stays per-route (deliberately 100 vs 200). */
export function buildSeerrPageInfo(take: number, skip: number, totalResults: number) {
  return {
    pages: Math.max(1, Math.ceil(totalResults / take)),
    pageSize: take,
    results: totalResults,
    page: Math.floor(skip / take) + 1,
  };
}

/** Request count per user (SeerrUser.requestCount), batched to avoid N queries. */
export async function countRequestsPerUser(userIds: number[]): Promise<Map<number, number>> {
  if (userIds.length === 0) return new Map();
  const groups = await prisma.mediaRequest.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.userId, g._count._all]));
}

/** The only media include every Seerr media read needs: seasons' statusCategory for partial-TV
 *  detection. Single source so a route can't silently forget it (which would report the wrong
 *  status with no error). */
export const SEERR_MEDIA_INCLUDE = { seasons: { select: { statusCategory: true } } } satisfies Prisma.MediaInclude;

/** A Media row with exactly the fields SEERR_MEDIA_INCLUDE loads — seasons is REQUIRED, so a route
 *  that forgets the include won't type-check against buildSeerrMedia. */
export type SeerrMediaWithSeasons = Prisma.MediaGetPayload<{ include: typeof SEERR_MEDIA_INCLUDE }>;

/** Include graph every Seerr request read needs so buildSeerrRequest sees a consistent shape
 *  (media+seasons for partial-TV status, user+providers, approvedBy+providers). */
export const SEERR_REQUEST_INCLUDE = {
  media: { include: SEERR_MEDIA_INCLUDE },
  user: { include: { providers: true } },
  approvedBy: { include: { providers: true } },
} satisfies Prisma.MediaRequestInclude;
