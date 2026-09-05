import { prisma } from '../utils/prisma.js';
import { isQualityAllowedForRole } from '../utils/qualityAccess.js';
import { pluginEngine } from '../plugins/engine.js';
import type { CreateRequestResult } from './requestService.js';

type RequestFailure = Extract<CreateRequestResult, { ok: false }>;

export async function checkRequestGuard(input: {
  userId: number;
  role: string;
  skipPluginGuard?: boolean;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  seasons?: number[];
}): Promise<RequestFailure | null> {
  if (input.role === 'admin' || input.skipPluginGuard) return null;
  const guard = await pluginEngine.runGuards('request.create', input.userId, {
    request: { tmdbId: input.tmdbId, mediaType: input.mediaType, seasons: input.seasons ?? null },
  });
  if (!guard?.blocked) return null;
  return {
    ok: false,
    status: (guard.statusCode || 403) as 403,
    code: 'BLOCKED_BY_GUARD',
    error: guard.error || 'Request blocked by plugin guard',
  };
}

/** A quality option can override the instance default, but never its role restriction. */
export async function resolveRequestApproval(
  role: string,
  autoApproveByDefault: boolean,
  qualityOptionId?: number,
): Promise<{ ok: true; autoApprove: boolean } | RequestFailure> {
  const defaultApproval = role === 'admin' || autoApproveByDefault;
  if (qualityOptionId == null) return { ok: true, autoApprove: defaultApproval };

  const quality = await prisma.qualityOption.findUnique({ where: { id: qualityOptionId } });
  if (!quality) return { ok: true, autoApprove: defaultApproval };
  if (role !== 'admin' && !isQualityAllowedForRole(quality.allowedRoles, role)) {
    return { ok: false, status: 403, code: 'QUALITY_NOT_ALLOWED', error: 'QUALITY_NOT_ALLOWED' };
  }
  if (quality.approvalMode === 'auto') return { ok: true, autoApprove: true };
  if (quality.approvalMode === 'manual') return { ok: true, autoApprove: role === 'admin' };
  return { ok: true, autoApprove: defaultApproval };
}

/** IDs have already been deduplicated. A request may pick only one value per criterion. */
export async function validateRequestCriteria(valueIds: number[]): Promise<RequestFailure | null> {
  if (valueIds.length === 0) return null;
  const values = await prisma.requestCriterionValue.findMany({
    where: { id: { in: valueIds } },
    select: { id: true, criterionId: true },
  });
  if (values.length !== valueIds.length) {
    return { ok: false, status: 400, code: 'UNKNOWN_CRITERION_VALUE', error: 'UNKNOWN_CRITERION_VALUE' };
  }
  const perCriterion = new Set(values.map(value => value.criterionId));
  if (perCriterion.size !== values.length) {
    return { ok: false, status: 400, code: 'CRITERION_CONFLICT', error: 'CRITERION_CONFLICT' };
  }
  return null;
}
