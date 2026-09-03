// Single source of truth for FolderRule condition fields/operators, shared by the backend matcher
// (evaluateCondition), the backend write-time validator, and the admin UI. All three MUST agree on
// which field×operator combinations do something — a combo not listed here silently never matches,
// so the validator rejects it and the UI must not offer it.

export const RULE_FIELDS = ['genre', 'language', 'country', 'user', 'role', 'tag', 'quality'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPERATORS = ['contains', 'is', 'in'] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** Operators that evaluateCondition actually honours per field. Anything else is a dead combo. */
export const RULE_FIELD_OPERATORS: Record<RuleField, readonly RuleOperator[]> = {
  genre: ['contains'],
  language: ['is', 'in'],
  country: ['contains', 'in'],
  user: ['is', 'in'],
  role: ['is', 'in'],
  tag: ['contains'],
  quality: ['is', 'in'],
};

export const RULE_MEDIA_TYPES = ['movie', 'tv'] as const;
export type RuleMediaType = (typeof RULE_MEDIA_TYPES)[number];

export const RULE_SERIES_TYPES = ['standard', 'anime', 'daily'] as const;
export type RuleSeriesType = (typeof RULE_SERIES_TYPES)[number];

export function isRuleField(v: unknown): v is RuleField {
  return typeof v === 'string' && (RULE_FIELDS as readonly string[]).includes(v);
}

export function isRuleOperator(v: unknown): v is RuleOperator {
  return typeof v === 'string' && (RULE_OPERATORS as readonly string[]).includes(v);
}

/** True iff `operator` does something for `field` in evaluateCondition. */
export function isOperatorSupported(field: RuleField, operator: RuleOperator): boolean {
  return RULE_FIELD_OPERATORS[field].includes(operator);
}

/** Operators the UI should offer for a field (= the ones that actually match). */
export function operatorsForField(field: RuleField): readonly RuleOperator[] {
  return RULE_FIELD_OPERATORS[field];
}

// ─── Admin-defined criteria ─────────────────────────────────────────
//
// The seven fields above are fixed: each one reads a known fact about the title or the requester.
// A criterion is different — the admin creates it, so its field name cannot be an enum member. It
// is addressed by id (`criterion:12`) rather than by name so that renaming "Langue" to "Piste
// audio" never orphans a rule, which is exactly the failure `qualityRuleLinks` exists to undo for
// quality labels.

const CRITERION_FIELD = /^criterion:(\d+)$/;

export function isCriterionField(v: unknown): v is `criterion:${number}` {
  return typeof v === 'string' && CRITERION_FIELD.test(v);
}

export function criterionIdOf(field: string): number | null {
  const m = CRITERION_FIELD.exec(field);
  return m ? Number(m[1]) : null;
}

export function criterionField(id: number): string {
  return `criterion:${id}`;
}

/** Same pair as `quality`: a criterion holds one value per request, so equality and membership. */
export const CRITERION_OPERATORS: readonly RuleOperator[] = ['is', 'in'];

/** Every field a rule may carry, built-in or admin-defined. */
export function isAnyRuleField(v: unknown): boolean {
  return isRuleField(v) || isCriterionField(v);
}

/** Operators to offer, for a built-in field or a criterion alike. */
export function operatorsForAnyField(field: string): readonly RuleOperator[] {
  return isCriterionField(field) ? CRITERION_OPERATORS : operatorsForField(field as RuleField);
}
