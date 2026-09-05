import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { matchFolderRule, classifyRuleService } from '../src/services/folderRules.js';
import { validateRulePayload } from '../src/services/folderRuleValidation.js';
import { findRulesUsingQuality, renameQualityInRules } from '../src/services/qualityRuleLinks.js';
import type { TmdbMovie, TmdbTv } from '../src/services/tmdb.js';

/** Minimal TMDB payloads — the matcher only reads genres, origin_country and original_language. */
const anime = {
  id: 1, genres: [{ id: 16, name: 'Animation' }], origin_country: ['JP'], original_language: 'ja',
} as unknown as TmdbTv;
const drama = {
  id: 2, genres: [{ id: 18, name: 'Drama' }], origin_country: ['US'], original_language: 'en',
} as unknown as TmdbTv;
const movie = {
  id: 3, genres: [{ id: 28, name: 'Action' }], original_language: 'fr',
} as unknown as TmdbMovie;

async function rule(overrides: Partial<{
  name: string; priority: number; mediaType: string; conditions: unknown;
  folderPath: string; seriesType: string | null; serviceId: number | null; enabled: boolean;
}> = {}) {
  return prisma.folderRule.create({
    data: {
      name: overrides.name ?? 'rule',
      priority: overrides.priority ?? 0,
      mediaType: overrides.mediaType ?? 'tv',
      conditions: JSON.stringify(overrides.conditions ?? [{ field: 'genre', operator: 'contains', value: 'animation' }]),
      folderPath: overrides.folderPath ?? '/data/anime',
      seriesType: overrides.seriesType ?? null,
      serviceId: overrides.serviceId ?? null,
      enabled: overrides.enabled ?? true,
    },
  });
}

beforeEach(async () => {
  await prisma.folderRule.deleteMany();
  await prisma.qualityOption.deleteMany();
  await prisma.service.deleteMany();
  await prisma.requestCriterion.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('matchFolderRule — matching', () => {
  it('matches on genre', async () => {
    await rule({ folderPath: '/data/anime' });
    expect((await matchFolderRule('tv', anime))?.folderPath).toBe('/data/anime');
  });

  it('does not match a different genre', async () => {
    await rule();
    expect(await matchFolderRule('tv', drama)).toBeNull();
  });

  it('matches on country and language', async () => {
    await rule({ conditions: [{ field: 'country', operator: 'contains', value: 'jp' }], folderPath: '/jp' });
    expect((await matchFolderRule('tv', anime))?.folderPath).toBe('/jp');

    await prisma.folderRule.deleteMany();
    await rule({ conditions: [{ field: 'language', operator: 'is', value: 'ja' }], folderPath: '/ja' });
    expect((await matchFolderRule('tv', anime))?.folderPath).toBe('/ja');
  });

  it('ANDs every condition in a rule', async () => {
    await rule({
      conditions: [
        { field: 'genre', operator: 'contains', value: 'animation' },
        { field: 'country', operator: 'contains', value: 'kr' },
      ],
    });
    // Genre matches, country does not — the rule must not fire.
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('ORs the comma-separated values inside one condition', async () => {
    await rule({ conditions: [{ field: 'country', operator: 'in', value: 'kr,jp,cn' }], folderPath: '/asia' });
    expect((await matchFolderRule('tv', anime))?.folderPath).toBe('/asia');
  });

  it('never crosses media types', async () => {
    await rule({ mediaType: 'movie', conditions: [{ field: 'genre', operator: 'contains', value: 'animation' }] });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('ignores disabled rules', async () => {
    await rule({ enabled: false });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('matches a movie on its own type', async () => {
    await rule({ mediaType: 'movie', conditions: [{ field: 'language', operator: 'is', value: 'fr' }], folderPath: '/vf' });
    expect((await matchFolderRule('movie', movie))?.folderPath).toBe('/vf');
  });
});

describe('matchFolderRule — ordering', () => {
  it('lowest priority number wins', async () => {
    await rule({ name: 'second', priority: 10, folderPath: '/second' });
    await rule({ name: 'first', priority: 1, folderPath: '/first' });
    expect((await matchFolderRule('tv', anime))?.ruleName).toBe('first');
  });

  it('is deterministic on equal priority — lowest id wins', async () => {
    const a = await rule({ name: 'a', priority: 5, folderPath: '/a' });
    await rule({ name: 'b', priority: 5, folderPath: '/b' });
    const match = await matchFolderRule('tv', anime);
    expect(match?.ruleName).toBe('a');
    expect(a.id).toBeLessThan((await prisma.folderRule.findFirst({ where: { name: 'b' } }))!.id);
  });
});

describe('matchFolderRule — resilience', () => {
  it('skips a rule with malformed condition JSON without breaking the others', async () => {
    await prisma.folderRule.create({
      data: { name: 'broken', priority: 1, mediaType: 'tv', conditions: '{not json', folderPath: '/broken', enabled: true },
    });
    await rule({ name: 'good', priority: 2, folderPath: '/good' });
    expect((await matchFolderRule('tv', anime))?.ruleName).toBe('good');
  });

  it('ignores a rule with no conditions rather than matching everything', async () => {
    await rule({ conditions: [] });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('ignores a condition whose value is not a string', async () => {
    await rule({ conditions: [{ field: 'genre', operator: 'contains', value: 42 }] });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('ignores an unknown field or operator', async () => {
    await rule({ conditions: [{ field: 'nonsense', operator: 'is', value: 'x' }] });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('does not resolve a field through the prototype chain', async () => {
    await rule({ conditions: [{ field: 'constructor', operator: 'is', value: 'x' }] });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });
});

describe('matchFolderRule — broken target service', () => {
  it('clears the link when the target service is deleted, so the rule keeps routing by folder', async () => {
    const svc = await prisma.service.create({
      data: { name: 'Sonarr', type: 'sonarr', config: '{}', enabled: true },
    });
    await rule({ name: 'pinned', serviceId: svc.id, folderPath: '/pinned' });
    await prisma.service.delete({ where: { id: svc.id } });

    // onDelete: SetNull — the rule survives with no service, which is a valid "folder only" rule.
    const match = await matchFolderRule('tv', anime);
    expect(match?.ruleName).toBe('pinned');
    expect(match?.serviceId).toBeNull();
  });

  it('skips a rule whose service is disabled', async () => {
    const svc = await prisma.service.create({
      data: { name: 'Sonarr off', type: 'sonarr', config: '{}', enabled: false },
    });
    await rule({ name: 'disabled', priority: 1, serviceId: svc.id });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('skips a rule pointing at the wrong *arr type', async () => {
    const svc = await prisma.service.create({
      data: { name: 'Radarr', type: 'radarr', config: '{}', enabled: true },
    });
    // A tv rule targeting Radarr can never work.
    await rule({ name: 'wrong-type', mediaType: 'tv', serviceId: svc.id });
    expect(await matchFolderRule('tv', anime)).toBeNull();
  });

  it('uses a rule whose service is healthy', async () => {
    const svc = await prisma.service.create({
      data: { name: 'Sonarr', type: 'sonarr', config: '{}', enabled: true },
    });
    await rule({ name: 'ok', serviceId: svc.id, folderPath: '/ok' });
    const match = await matchFolderRule('tv', anime);
    expect(match?.ruleName).toBe('ok');
    expect(match?.serviceId).toBe(svc.id);
  });

  it('classifies service health consistently', () => {
    expect(classifyRuleService(null, null, 'tv')).toBe('no-service');
    expect(classifyRuleService(null, 1, 'tv')).toBe('missing');
    expect(classifyRuleService({ enabled: false, type: 'sonarr' }, 1, 'tv')).toBe('disabled');
    expect(classifyRuleService({ enabled: true, type: 'radarr' }, 1, 'tv')).toBe('wrong-type');
    expect(classifyRuleService({ enabled: true, type: 'sonarr' }, 1, 'tv')).toBe('ok');
  });
});

describe('validateRulePayload', () => {
  it.each([
    [null, /each condition must be an object/],
    [{ field: 'genre', operator: 'unknown', value: 'x' }, /unknown operator/],
    [{ field: 'genre', operator: 'is', value: ' ' }, /non-empty string/],
    [{ field: 'unknown', operator: 'is', value: 'x' }, /unknown condition field/],
  ])('rejects malformed condition %j', async (condition, error) => {
    expect(await validateRulePayload({ mediaType: 'tv', conditions: [condition] })).toMatch(error);
  });

  it('rejects an unknown media type', async () => {
    expect(await validateRulePayload({ mediaType: 'book', conditions: [{ field: 'genre', operator: 'contains', value: 'x' }] })).toMatch(/mediaType/);
  });

  it('rejects empty conditions', async () => {
    expect(await validateRulePayload({ mediaType: 'tv', conditions: [] })).toMatch(/at least one condition/);
  });

  it('rejects a quality value with no matching option', async () => {
    await prisma.qualityOption.create({ data: { label: 'HD', position: 1 } });
    const err = await validateRulePayload({ mediaType: 'tv', conditions: [{ field: 'quality', operator: 'is', value: '8K' }] });
    expect(err).toMatch(/quality value/);
  });

  it('accepts a quality value backed by an option', async () => {
    await prisma.qualityOption.create({ data: { label: '4K', position: 1 } });
    expect(await validateRulePayload({ mediaType: 'tv', conditions: [{ field: 'quality', operator: 'is', value: '4K' }] })).toBeNull();
  });
});

describe('criterion condition validation', () => {
  async function criterionRule(value: string, operator = 'is') {
    const criterion = await prisma.requestCriterion.create({
      data: { name: 'Language', values: { create: [{ label: 'French' }, { label: 'English' }] } },
    });
    return validateRulePayload({ mediaType: 'any', conditions: [{ field: `criterion:${criterion.id}`, operator, value }] });
  }

  it('accepts multiple configured values with whitespace and case differences', async () => {
    expect(await criterionRule(' FRENCH, English ')).toBeNull();
  });

  it('rejects an unknown criterion', async () => {
    expect(await validateRulePayload({
      mediaType: 'tv', conditions: [{ field: 'criterion:2147483647', operator: 'is', value: 'French' }],
    })).toMatch(/criterion .* does not exist/);
  });

  it('rejects values outside the named criterion', async () => {
    expect(await criterionRule('German')).toMatch(/value\(s\) not configured/);
  });

  it('rejects operators that cannot match a criterion', async () => {
    expect(await criterionRule('French', 'contains')).toMatch(/does nothing for a criterion/);
  });
});

/**
 * Regression cover for the asymmetric guard: creating a rule validated the quality label, but
 * renaming or deleting the option from the other side left the rule pointing at a label that no
 * longer existed. It matched nothing, silently, and media went to the default folder.
 */
describe('quality ↔ folder rule link', () => {
  it('finds the rules that reference a quality label', async () => {
    await rule({ name: 'uhd', conditions: [{ field: 'quality', operator: 'is', value: '4K' }] });
    await rule({ name: 'unrelated', conditions: [{ field: 'genre', operator: 'contains', value: 'animation' }] });
    const found = await findRulesUsingQuality('4K');
    expect(found.map((r) => r.name)).toEqual(['uhd']);
  });

  it('matches the label case-insensitively, like the matcher does', async () => {
    await rule({ name: 'uhd', conditions: [{ field: 'quality', operator: 'is', value: '4k' }] });
    expect(await findRulesUsingQuality('4K')).toHaveLength(1);
  });

  it('rewrites rules when a quality is renamed', async () => {
    await rule({ name: 'uhd', conditions: [{ field: 'quality', operator: 'is', value: '4K' }] });
    expect(await renameQualityInRules('4K', 'UHD')).toBe(1);

    const saved = await prisma.folderRule.findFirst({ where: { name: 'uhd' } });
    expect(JSON.parse(saved!.conditions)[0].value).toBe('UHD');
    expect(await findRulesUsingQuality('UHD')).toHaveLength(1);
    expect(await findRulesUsingQuality('4K')).toHaveLength(0);
  });

  it('keeps the other values of a multi-value condition', async () => {
    await rule({ name: 'multi', conditions: [{ field: 'quality', operator: 'is', value: 'HD,4K' }] });
    await renameQualityInRules('4K', 'UHD');
    const saved = await prisma.folderRule.findFirst({ where: { name: 'multi' } });
    expect(JSON.parse(saved!.conditions)[0].value).toBe('HD,UHD');
  });

  it('leaves non-quality conditions alone', async () => {
    await rule({ name: 'genre', conditions: [{ field: 'genre', operator: 'contains', value: '4K' }] });
    expect(await renameQualityInRules('4K', 'UHD')).toBe(0);
  });

  it('is a no-op when the label does not change', async () => {
    await rule({ name: 'uhd', conditions: [{ field: 'quality', operator: 'is', value: '4K' }] });
    expect(await renameQualityInRules('4K', '4K')).toBe(0);
  });

  it('a renamed quality keeps routing media', async () => {
    await prisma.qualityOption.create({ data: { label: '4K', position: 1 } });
    const option = await prisma.qualityOption.findFirst({ where: { label: '4K' } });
    await rule({ name: 'uhd-anime', conditions: [{ field: 'quality', operator: 'is', value: '4K' }], folderPath: '/uhd' });

    expect((await matchFolderRule('tv', anime, null, option!.id))?.folderPath).toBe('/uhd');

    // The rename that used to break everything.
    await prisma.qualityOption.update({ where: { id: option!.id }, data: { label: 'UHD' } });
    await renameQualityInRules('4K', 'UHD');

    expect((await matchFolderRule('tv', anime, null, option!.id))?.folderPath).toBe('/uhd');
  });
});
