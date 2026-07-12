import { prisma } from '../utils/prisma.js';
import { getAppSettings } from '../utils/appSettings.js';
import type { TmdbMovie, TmdbTv } from './tmdb.js';
import { logEvent } from '../utils/logEvent.js';

export interface RuleCondition {
  field: 'genre' | 'language' | 'country' | 'user' | 'role' | 'tag' | 'quality';
  operator: 'contains' | 'is' | 'in';
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

async function resolveKeywordTags(tmdbId: number | null): Promise<string[]> {
  if (!tmdbId) return [];

  const media = await prisma.media.findFirst({
    where: { tmdbId },
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
    resolveKeywordTags(tmdbId),
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
  const values = condition.value.split(',').map(v => v.trim().toLowerCase());

  switch (condition.field) {
    case 'genre':
      if (condition.operator === 'contains') {
        return values.some(v => ctx.genres.includes(v));
      }
      return false;

    case 'language':
      if (condition.operator === 'is' || condition.operator === 'in') {
        return values.includes(ctx.originalLanguage.toLowerCase());
      }
      return false;

    case 'country':
      if (condition.operator === 'contains' || condition.operator === 'in') {
        return values.some(v => ctx.originCountry.includes(v));
      }
      return false;

    case 'user':
      if (condition.operator === 'is' || condition.operator === 'in') {
        return ctx.userId !== null && values.includes(ctx.userId.toString());
      }
      return false;

    case 'role':
      if (condition.operator === 'is') {
        return ctx.userRole !== null && values.includes(ctx.userRole.toLowerCase());
      }
      return false;

    case 'tag':
      if (condition.operator === 'contains') {
        return values.some(v => ctx.keywordTags.includes(v));
      }
      return false;

    case 'quality':
      if (condition.operator === 'is' || condition.operator === 'in') {
        return ctx.qualityLabel !== null && values.includes(ctx.qualityLabel.toLowerCase());
      }
      return false;

    default:
      return false;
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
    orderBy: { priority: 'asc' },
  });

  if (rules.length === 0) return null;

  const ctx = await buildContext(mediaType, tmdbData, userId, qualityOptionId);

  for (const rule of rules) {
    const conditions = parseRuleConditions(rule);
    if (!conditions) continue;

    const allMatch = conditions.length > 0 && conditions.every(c => evaluateCondition(c, ctx));
    if (!allMatch) continue;

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
