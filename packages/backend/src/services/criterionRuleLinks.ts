import { prisma } from '../utils/prisma.js';
import { criterionField } from '@oscarr/shared';

/**
 * Rules that would stop matching if a criterion disappeared.
 *
 * Unlike quality options, a criterion is addressed by id, so renaming it cannot orphan anything —
 * that whole class of bug is designed out. Deleting still can: the rule keeps its condition, the
 * field no longer resolves, and it silently matches nothing. Media then falls through to the
 * default folder with no error raised, which is exactly what `qualityRuleLinks` was written to
 * stop happening for labels.
 */
export async function findRulesUsingCriterion(criterionId: number): Promise<{ id: number; name: string }[]> {
  const field = criterionField(criterionId);
  const rules = await prisma.folderRule.findMany({ select: { id: true, name: true, conditions: true } });

  return rules.filter((rule) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rule.conditions);
    } catch {
      // A rule whose conditions do not parse matches nothing already; it cannot be holding this
      // criterion, and reporting it here would block a delete for the wrong reason.
      return false;
    }
    if (!Array.isArray(parsed)) return false;
    return parsed.some((c) => (c as { field?: unknown })?.field === field);
  }).map(({ id, name }) => ({ id, name }));
}
