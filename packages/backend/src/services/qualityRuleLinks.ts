import { prisma } from '../utils/prisma.js';
import { logEvent } from '../utils/logEvent.js';

/**
 * Folder rules reference a quality by its *label*, not by id, so the link is a plain string with
 * nothing enforcing it. Creating a rule already validates the label exists (H7), but that guard
 * only points one way: renaming or deleting the option from the other side silently orphaned every
 * rule using it. The rule kept matching nothing, media fell through to the default folder, and no
 * error was ever raised.
 *
 * These helpers close the loop — cascade on rename, refuse on delete.
 */

interface RuleRef {
  id: number;
  name: string;
}

interface Condition {
  field?: unknown;
  operator?: unknown;
  value?: unknown;
}

function conditionsOf(raw: string): Condition[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Condition[]) : null;
  } catch {
    return null;
  }
}

function valuesOf(condition: Condition): string[] {
  return typeof condition.value === 'string'
    ? condition.value.split(',').map((v) => v.trim()).filter(Boolean)
    : [];
}

/** Rules whose `quality` conditions mention this label (case-insensitive, as the matcher compares). */
export async function findRulesUsingQuality(label: string): Promise<RuleRef[]> {
  const target = label.trim().toLowerCase();
  if (!target) return [];

  const rules = await prisma.folderRule.findMany({ select: { id: true, name: true, conditions: true } });
  return rules
    .filter((rule) => {
      const conditions = conditionsOf(rule.conditions);
      if (!conditions) return false;
      return conditions.some((c) => c.field === 'quality' && valuesOf(c).some((v) => v.toLowerCase() === target));
    })
    .map(({ id, name }) => ({ id, name }));
}

/**
 * Rewrites `quality` conditions from one label to another. A rename is the admin saying "same
 * concept, different name", so the rules follow rather than break. Returns how many were rewritten.
 */
export async function renameQualityInRules(oldLabel: string, newLabel: string): Promise<number> {
  const from = oldLabel.trim().toLowerCase();
  const to = newLabel.trim();
  if (!from || !to || from === to.toLowerCase()) return 0;

  const affected = await prisma.folderRule.findMany({ select: { id: true, name: true, conditions: true } });
  let updated = 0;

  for (const rule of affected) {
    const conditions = conditionsOf(rule.conditions);
    if (!conditions) continue;

    let touched = false;
    const next = conditions.map((c) => {
      if (c.field !== 'quality') return c;
      const values = valuesOf(c);
      if (!values.some((v) => v.toLowerCase() === from)) return c;
      touched = true;
      // Preserve the rest of a multi-value condition ("HD,4K" keeps HD when 4K is renamed), and
      // drop duplicates in case the new label was already listed.
      const rewritten = [...new Set(values.map((v) => (v.toLowerCase() === from ? to : v)))];
      return { ...c, value: rewritten.join(',') };
    });

    if (!touched) continue;
    await prisma.folderRule.update({ where: { id: rule.id }, data: { conditions: JSON.stringify(next) } });
    updated++;
  }

  if (updated > 0) {
    logEvent('info', 'FolderRules', `Quality renamed "${oldLabel}" → "${newLabel}"; ${updated} folder rule(s) updated to match`);
  }
  return updated;
}
