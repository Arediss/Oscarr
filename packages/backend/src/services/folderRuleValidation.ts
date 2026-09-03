import { prisma } from '../utils/prisma.js';
import {
  isRuleField, isRuleOperator, isOperatorSupported,
  isCriterionField, criterionIdOf, CRITERION_OPERATORS,
  RULE_MEDIA_TYPES, RULE_SERIES_TYPES,
} from '@oscarr/shared';
import { checkRuleService } from './folderRules.js';
import { findServiceTypeForMedia } from '../providers/index.js';

export interface RulePayload {
  mediaType: string;
  conditions: unknown;
  seriesType?: string | null;
  serviceId?: number | null;
}

/** On a partial PUT, skip a cross-field check when the field it depends on isn't being changed, so
 *  an unrelated edit (e.g. rename) can't be blocked by a pre-existing service/condition problem the
 *  admin is trying to repair. mediaType changes re-enable both (it affects quality + wrong-type). */
export interface ValidateRuleOptions {
  skipConditions?: boolean;
  skipService?: boolean;
}

/** Write-time semantic validation shared by POST and PUT /folder-rules. Rejects rules that would be
 *  persisted but can never fire or would route incorrectly: unknown mediaType/seriesType, empty or
 *  malformed conditions, dead field/operator combos (H2/M1/B1), quality values not backed by a
 *  configured QualityOption (H7), and a serviceId that doesn't exist or is the wrong *arr type (H3).
 *  Returns a human-readable error string, or null when the payload is valid. */
export async function validateRulePayload(input: RulePayload, opts: ValidateRuleOptions = {}): Promise<string | null> {
  const { mediaType, conditions, seriesType, serviceId } = input;

  if (!(RULE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return `mediaType must be one of: ${RULE_MEDIA_TYPES.join(', ')}`;
  }
  if (seriesType != null && seriesType !== '' && !(RULE_SERIES_TYPES as readonly string[]).includes(seriesType)) {
    return `seriesType must be one of: ${RULE_SERIES_TYPES.join(', ')}`;
  }

  if (!opts.skipConditions) {
    const conditionsError = await validateConditions(conditions);
    if (conditionsError) return conditionsError;
  }

  if (!opts.skipService && serviceId != null) {
    const status = await checkRuleService(serviceId, mediaType);
    if (status === 'missing') return `service id ${serviceId} does not exist`;
    if (status === 'wrong-type') return `service id ${serviceId} is not a ${findServiceTypeForMedia(mediaType) ?? mediaType} service`;
    // 'disabled' is allowed at write time (the service may be re-enabled); GET flags it as a warning.
  }

  return null;
}

async function validateConditions(conditions: unknown): Promise<string | null> {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return 'at least one condition is required';
  }

  let qualityLabels: Set<string> | null = null;
  for (const c of conditions) {
    if (!c || typeof c !== 'object') return 'each condition must be an object';
    const { field, operator, value } = c as { field?: unknown; operator?: unknown; value?: unknown };
    if (!isRuleOperator(operator)) return `unknown operator "${String(operator)}"`;
    if (typeof value !== 'string' || value.trim() === '') return `condition value for "${String(field)}" must be a non-empty string`;

    if (isCriterionField(field)) {
      // Same contract as quality below: a condition naming a criterion or a value that does not
      // exist would sit in the rule matching nothing, and the admin would hunt for why routing
      // stopped. Refuse at write time rather than fail silently at dispatch.
      if (!CRITERION_OPERATORS.includes(operator)) {
        return `operator "${operator}" does nothing for a criterion`;
      }
      const criterionId = criterionIdOf(field)!;
      const criterion = await prisma.requestCriterion.findUnique({
        where: { id: criterionId },
        select: { name: true, values: { select: { label: true } } },
      });
      if (!criterion) return `criterion ${criterionId} does not exist`;
      const known = new Set(criterion.values.map(v => v.label.toLowerCase()));
      const vals = value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      const unknown = vals.filter(v => !known.has(v));
      if (unknown.length) {
        return `value(s) not configured for criterion "${criterion.name}": ${unknown.join(', ')}`;
      }
      continue;
    }

    if (!isRuleField(field)) return `unknown condition field "${String(field)}"`;
    if (!isOperatorSupported(field, operator)) return `operator "${operator}" does nothing for field "${field}"`;

    if (field === 'quality') {
      if (!qualityLabels) {
        const opts = await prisma.qualityOption.findMany({ select: { label: true } });
        qualityLabels = new Set(opts.map(o => o.label.toLowerCase()));
      }
      const vals = value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
      const unknown = vals.filter(v => !qualityLabels!.has(v));
      if (unknown.length) return `quality value(s) not found in configured quality options: ${unknown.join(', ')}`;
    }
  }

  return null;
}
