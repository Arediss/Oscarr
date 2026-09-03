import { describe, it, expect } from 'vitest';
import {
  isCriterionField, criterionIdOf, criterionField, isAnyRuleField,
  operatorsForAnyField, isRuleField,
} from '@oscarr/shared';

/**
 * Folder rule fields come in two families: seven fixed ones, and one per criterion the admin
 * created. The second family is addressed by id rather than by name so renaming a criterion cannot
 * orphan a rule — the failure `qualityRuleLinks` exists to undo for quality labels.
 *
 * Three consumers must agree on what a field is: the matcher, the write-time validator, and the
 * admin UI. These pin the shape they all read.
 */
describe('criterion rule fields', () => {
  it('round-trips an id', () => {
    expect(criterionField(12)).toBe('criterion:12');
    expect(criterionIdOf('criterion:12')).toBe(12);
  });

  it('recognises only the exact shape', () => {
    expect(isCriterionField('criterion:1')).toBe(true);
    expect(isCriterionField('criterion:')).toBe(false);
    expect(isCriterionField('criterion:abc')).toBe(false);
    expect(isCriterionField('criterion:1 ')).toBe(false);
    expect(isCriterionField('xcriterion:1')).toBe(false);
    expect(isCriterionField(null)).toBe(false);
    expect(isCriterionField(12)).toBe(false);
  });

  it('returns null for anything that is not one', () => {
    expect(criterionIdOf('quality')).toBeNull();
    expect(criterionIdOf('criterion:x')).toBeNull();
  });

  // A criterion must never be mistaken for a built-in field, or the matcher would look it up in
  // the wrong place and silently match nothing.
  it('keeps the two families apart', () => {
    expect(isRuleField('criterion:1')).toBe(false);
    expect(isCriterionField('quality')).toBe(false);
    expect(isAnyRuleField('criterion:1')).toBe(true);
    expect(isAnyRuleField('quality')).toBe(true);
    expect(isAnyRuleField('nonsense')).toBe(false);
  });

  it('offers equality and membership for a criterion, like quality', () => {
    expect(operatorsForAnyField('criterion:3')).toEqual(['is', 'in']);
    expect(operatorsForAnyField('quality')).toEqual(['is', 'in']);
    expect(operatorsForAnyField('genre')).toEqual(['contains']);
  });
});
