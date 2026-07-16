import { prisma } from '../utils/prisma.js';
import { getAppSettings } from '../utils/appSettings.js';
import type { TmdbMovie, TmdbTv } from './tmdb.js';
import { logEvent } from '../utils/logEvent.js';
import { isOperatorSupported, isRuleField, isRuleOperator, type RuleField, type RuleOperator } from '@oscarr/shared';
import { findServiceTypeForMedia } from '../providers/index.js';

export interface RuleCondition {
  field: RuleField;       // shared single source (@oscarr/shared)
  operator: RuleOperator; // shared single source (@oscarr/shared)
  value: string; // Comma-separated for "in" operator
}

export interface RuleMatch {
  ruleName: string;
  folderPath: string;
  seriesType?: string | null;
  serviceId?: number | null;
}

interface MediaContext {
  mediaType: 'movie' | 'tv';
  genres: string[];
  originCountry: string[];
  originalLanguage: string;
  userId: number | null;
  userRole: string | null;
  keywordTags: string[];
  qualityLabel: string | null;
}

async function resolveUserRole(userId: number | null): Promise<string | null> {
  if (userId === null) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role ?? null;
}

function parseKeywordIds(raw: string, tmdbId: number): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    logEvent('debug', 'FolderRules', `Malformed keywordIds for tmdbId=${tmdbId}: ${raw}`);
    return [];
  }
}

async function resolveKeywordTags(tmdbId: number | null, mediaType: 'movie' | 'tv'): Promise<string[]> {
  if (!tmdbId) return [];

  // Composite key: TMDB movie/tv id namespaces are independent, so a bare tmdbId could read the
  // wrong media row's keywords (a movie's keywords for a tv rule, or vice versa).
  const media = await prisma.media.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    select: { keywordIds: true },
  });
  if (!media?.keywordIds) return [];

  const ids = parseKeywordIds(media.keywordIds, tmdbId);
  if (ids.length === 0) return [];

  const keywords = await prisma.keyword.findMany({
    where: { tmdbId: { in: ids }, tag: { not: null } },
    select: { tag: true },
  });

  const tags = new Set<string>();
  for (const kw of keywords) {
    if (kw.tag) tags.add(kw.tag);
  }
  return [...tags];
}

async function buildContext(
  mediaType: 'movie' | 'tv',
  tmdbData: TmdbMovie | TmdbTv,
  userId: number | null,
  qualityOptionId?: number | null,
): Promise<MediaContext> {
  const genres = tmdbData.genres?.map(g => g.name.toLowerCase()) ?? [];
  const originCountry = 'origin_country' in tmdbData ? (tmdbData.origin_country ?? []) : [];
  const originalLanguage = 'original_language' in tmdbData ? (tmdbData.original_language ?? '') : '';

  const tmdbId = 'id' in tmdbData ? tmdbData.id : null;
  const [userRole, keywordTags, qualityOption] = await Promise.all([
    resolveUserRole(userId),
    resolveKeywordTags(tmdbId, mediaType),
    qualityOptionId ? prisma.qualityOption.findUnique({ where: { id: qualityOptionId }, select: { label: true } }) : null,
  ]);

  return {
    mediaType, genres,
    originCountry: originCountry.map(c => c.toLowerCase()),
    originalLanguage,
    userId, userRole,
    keywordTags: keywordTags.map(t => t.toLowerCase()),
    qualityLabel: qualityOption?.label ?? null,
  };
}

function evaluateCondition(condition: RuleCondition, ctx: MediaContext): boolean {
  // Conditions come from stored JSON, so field/operator/value can be anything at runtime. Guard
  // before the split (a non-string value used to throw and take out the whole matcher — H2), and
  // gate the field/operator against the shared support matrix so a dead combo just returns false.
  if (typeof condition.value !== 'string') return false;
  if (!isRuleField(condition.field) || !isRuleOperator(condition.operator)) return false;
  if (!isOperatorSupported(condition.field, condition.operator)) return false;

  const values = condition.value.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) return false;

  // Every supported operator is OR-membership; the field only decides which context axis to match.
  switch (condition.field) {
    case 'genre': return values.some(v => ctx.genres.includes(v));
    case 'language': return values.includes(ctx.originalLanguage.toLowerCase());
    case 'country': return values.some(v => ctx.originCountry.includes(v));
    case 'user': return ctx.userId !== null && values.includes(ctx.userId.toString());
    case 'role': return ctx.userRole !== null && values.includes(ctx.userRole.toLowerCase());
    case 'tag': return values.some(v => ctx.keywordTags.includes(v));
    case 'quality': return ctx.qualityLabel !== null && values.includes(ctx.qualityLabel.toLowerCase());
    default: return false;
  }
}

function parseRuleConditions(rule: { id: number; name: string; conditions: string }): RuleCondition[] | null {
  try {
    return JSON.parse(rule.conditions);
  } catch {
    logEvent('debug', 'FolderRules', `Malformed conditions in rule id=${rule.id} "${rule.name}", skipping`);
    return null;
  }
}

async function resolveDefaultFolder(
  mediaType: 'movie' | 'tv',
  seriesType: string | null,
): Promise<string> {
  const settings = await getAppSettings();
  if (seriesType === 'anime' && settings?.defaultAnimeFolder) return settings.defaultAnimeFolder;
  if (mediaType === 'tv' && settings?.defaultTvFolder) return settings.defaultTvFolder;
  if (mediaType === 'movie' && settings?.defaultMovieFolder) return settings.defaultMovieFolder;
  return '';
}

export async function matchFolderRule(
  mediaType: 'movie' | 'tv',
  tmdbData: TmdbMovie | TmdbTv,
  userId: number | null = null,
  qualityOptionId?: number | null,
): Promise<RuleMatch | null> {
  const rules = await prisma.folderRule.findMany({
    where: { mediaType, enabled: true },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }], // M4: deterministic winner on equal priority
  });

  if (rules.length === 0) return null;

  const ctx = await buildContext(mediaType, tmdbData, userId, qualityOptionId);

  for (const rule of rules) {
    const conditions = parseRuleConditions(rule);
    if (!conditions) continue;

    let allMatch: boolean;
    try {
      allMatch = conditions.length > 0 && conditions.every(c => evaluateCondition(c, ctx));
    } catch (err) {
      // Belt-and-suspenders (evaluateCondition is already guarded): one poisoned rule must never
      // take down routing for the whole mediaType.
      logEvent('warn', 'FolderRules', `Rule id=${rule.id} "${rule.name}" threw during evaluation, skipping: ${String(err)}`);
      continue;
    }
    if (!allMatch) continue;

    // H1: a matched rule whose target service is disabled/deleted/wrong-type must NOT silently route
    // media to a fallback instance with this rule's folderPath. Treat it as non-functional and skip
    // (routing falls through to the next rule or the default); the admin panel surfaces the warning.
    if (rule.serviceId != null) {
      const status = await checkRuleService(rule.serviceId, mediaType);
      if (status !== 'ok') {
        logEvent('warn', 'FolderRules', `Rule id=${rule.id} "${rule.name}" matched but its service is "${status}"; skipping (non-functional).`);
        continue;
      }
    }

    const folderPath = rule.folderPath || await resolveDefaultFolder(mediaType, rule.seriesType);
    return {
      ruleName: rule.name,
      folderPath,
      seriesType: rule.seriesType,
      serviceId: rule.serviceId,
    };
  }

  return null;
}

export type RuleServiceStatus = 'ok' | 'no-service' | 'missing' | 'disabled' | 'wrong-type';

/** Health of the service a rule targets. 'no-service' (serviceId null) = the rule uses default
 *  routing and only overrides folder/seriesType, which is valid. missing/disabled/wrong-type make
 *  the rule non-functional: matchFolderRule skips it and the admin panel flags it. Single source
 *  consumed by the matcher, the write-time validator and GET /folder-rules. */
export async function checkRuleService(serviceId: number | null, mediaType: string): Promise<RuleServiceStatus> {
  if (serviceId == null) return 'no-service';
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return 'missing';
  if (!service.enabled) return 'disabled';
  if (service.type !== findServiceTypeForMedia(mediaType)) return 'wrong-type';
  return 'ok';
}
