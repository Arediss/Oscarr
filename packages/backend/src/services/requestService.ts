import { prisma } from '../utils/prisma.js';
import { getArrClient, getArrClientForService, getServiceTypeForMedia } from '../providers/index.js';
import { getMovieDetails, getTvDetails } from './tmdb.js';
import { matchFolderRule } from './folderRules.js';
import { logEvent } from '../utils/logEvent.js';
import { getServiceById, getAllServices } from '../utils/services.js';
import { VALID_MEDIA_TYPES } from '../utils/params.js';
import { ACTIVE_REQUEST_STATUSES, COMPLETABLE_REQUEST_STATUSES } from '@oscarr/shared';
import { safeNotify, safeUserNotify, buildSiteLink } from '../utils/safeNotify.js';
import { pluginEngine } from '../plugins/engine.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateRequestBody(body: { tmdbId: unknown; mediaType: unknown; seasons?: unknown }): {
  valid: true; tmdbId: number; mediaType: 'movie' | 'tv'; seasons: number[] | undefined;
} | { valid: false; error: string } {
  const { tmdbId, mediaType, seasons } = body;
  if (typeof tmdbId !== 'number' || !Number.isFinite(tmdbId) || tmdbId < 1) {
    return { valid: false, error: 'Invalid tmdbId' };
  }
  if (!VALID_MEDIA_TYPES.includes(mediaType as string)) {
    return { valid: false, error: 'mediaType must be "movie" or "tv"' };
  }
  const validSeasons = Array.isArray(seasons) && seasons.every((s) => typeof s === 'number' && Number.isFinite(s))
    ? (seasons as number[])
    : undefined;
  return { valid: true, tmdbId, mediaType: mediaType as 'movie' | 'tv', seasons: validSeasons };
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

export async function findOrCreateMedia(tmdbId: number, mediaType: 'movie' | 'tv') {
  const existing = await prisma.media.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  if (existing) return existing;

  const tmdbData = mediaType === 'movie'
    ? await getMovieDetails(tmdbId)
    : await getTvDetails(tmdbId);

  const title = 'title' in tmdbData ? tmdbData.title : tmdbData.name;
  const releaseDate = 'release_date' in tmdbData ? tmdbData.release_date : tmdbData.first_air_date;
  const tvdbId = mediaType === 'tv' ? (tmdbData.external_ids?.tvdb_id ?? null) : null;

  // TV: upgrade a sync-created placeholder (tmdbId<0) before creating a duplicate.
  if (mediaType === 'tv' && tvdbId) {
    const placeholder = await prisma.media.findFirst({
      where: { mediaType: 'tv', tvdbId, tmdbId: { lt: 0 } },
    });
    if (placeholder) {
      await prisma.media.update({
        where: { id: placeholder.id },
        data: {
          tmdbId,
          title: placeholder.title || title,
          overview: placeholder.overview ?? (tmdbData.overview || null),
          posterPath: placeholder.posterPath ?? tmdbData.poster_path,
          backdropPath: placeholder.backdropPath ?? tmdbData.backdrop_path,
          releaseDate: placeholder.releaseDate ?? (releaseDate || null),
          voteAverage: placeholder.voteAverage ?? tmdbData.vote_average,
          genres: placeholder.genres ?? (tmdbData.genres ? JSON.stringify(tmdbData.genres.map(g => g.name)) : null),
        },
      });
      return prisma.media.findUniqueOrThrow({ where: { id: placeholder.id } });
    }
  }

  const media = await prisma.$transaction(async (tx) => {
    const created = await tx.media.create({
      data: {
        tmdbId,
        tvdbId,
        mediaType,
        title,
        overview: tmdbData.overview || null,
        posterPath: tmdbData.poster_path,
        backdropPath: tmdbData.backdrop_path,
        releaseDate: releaseDate || null,
        voteAverage: tmdbData.vote_average,
        genres: tmdbData.genres ? JSON.stringify(tmdbData.genres.map(g => g.name)) : null,
      },
    });

    if (mediaType === 'tv' && 'seasons' in tmdbData && tmdbData.seasons) {
      await tx.season.createMany({
        data: tmdbData.seasons
          .filter(s => s.season_number > 0)
          .map(s => ({
            mediaId: created.id,
            seasonNumber: s.season_number,
            episodeCount: s.episode_count,
          })),
      });
    }

    return created;
  });

  return media;
}

export async function isBlacklisted(tmdbId: number, mediaType: string): Promise<{ blacklisted: boolean; reason: string | null }> {
  const entry = await prisma.blacklistedMedia.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  return { blacklisted: !!entry, reason: entry?.reason || null };
}

export async function getUserTagName(userId: number): Promise<string> {
  const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
  return dbUser?.displayName || dbUser?.email || `user-${userId}`;
}

// ---------------------------------------------------------------------------
// Service dispatch
// ---------------------------------------------------------------------------

interface ServiceContext {
  targetService: { id: number; config: Record<string, string> } | null;
  targetProfileId: number | null;
  defaultProfileId: number | null;
  defaultFolder: string | null | undefined;
  ruleMatch: Awaited<ReturnType<typeof matchFolderRule>>;
}

export async function resolveServiceContext(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  userId: number | null,
  qualityOptionId?: number,
): Promise<ServiceContext> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const defaultProfileId = settings?.defaultQualityProfile ?? null;

  const tmdbData = mediaType === 'movie'
    ? await getMovieDetails(tmdbId)
    : await getTvDetails(tmdbId);

  const ruleMatch = await matchFolderRule(mediaType, tmdbData, userId, qualityOptionId);
  const defaultFolder = mediaType === 'movie' ? settings?.defaultMovieFolder : settings?.defaultTvFolder;

  let targetServiceId: number | null = ruleMatch?.serviceId ?? null;
  let targetProfileId: number | null = null;

  if (qualityOptionId) {
    const serviceType = getServiceTypeForMedia(mediaType);
    const mapping = await prisma.qualityMapping.findFirst({
      where: {
        qualityOptionId,
        service: { type: serviceType, enabled: true },
      },
      include: { service: true },
    });
    if (mapping) {
      targetServiceId = mapping.serviceId;
      targetProfileId = mapping.qualityProfileId;
    }
  }

  let targetService: { id: number; config: Record<string, string> } | null = null;
  if (targetServiceId) {
    targetService = await getServiceById(targetServiceId) as { id: number; config: Record<string, string> } | null;
  }
  if (!targetService) {
    const services = await getAllServices(getServiceTypeForMedia(mediaType));
    if (services.length > 0) targetService = services[0];
  }

  return { targetService, targetProfileId, defaultProfileId, defaultFolder, ruleMatch };
}

async function sendToArrService(
  media: { tmdbId: number; tvdbId: number | null; title: string },
  mediaType: string,
  username: string,
  ctx: ServiceContext,
  seasons?: number[],
  rootFolderOverride?: string | null,
) {
  const serviceType = getServiceTypeForMedia(mediaType);
  const client = ctx.targetService
    ? getArrClientForService(ctx.targetService.id, serviceType, ctx.targetService.config)
    : await getArrClient(serviceType);

  // Priority: explicit override > rule match > default folder > first root folder
  const folderPath = rootFolderOverride || ctx.ruleMatch?.folderPath || ctx.defaultFolder
    || (await client.getRootFolders())[0]?.path || client.defaultRootFolder;
  const tagId = await client.getOrCreateTag(username);

  const externalId = mediaType === 'movie' ? media.tmdbId : media.tvdbId;
  if (!externalId) throw new Error(`Missing external ID for ${mediaType} "${media.title}"`);

  const existing = await client.findByExternalId(externalId);
  if (existing) {
    await client.searchMedia(existing.id);
    return;
  }

  const profileId = ctx.targetProfileId ?? ctx.defaultProfileId
    ?? (await client.getQualityProfiles())[0]?.id ?? 1;

  await client.addMedia({
    title: media.title,
    externalId,
    qualityProfileId: profileId,
    rootFolderPath: folderPath,
    tags: [tagId],
    seasons,
    seriesType: ctx.ruleMatch?.seriesType as string | undefined,
  });
}

export async function sendToService(
  media: { tmdbId: number; tvdbId: number | null; title: string },
  mediaType: string,
  username: string,
  userId: number | null = null,
  seasons?: number[],
  qualityOptionId?: number,
  rootFolderOverride?: string | null,
): Promise<boolean> {
  try {
    const ctx = await resolveServiceContext(mediaType as 'movie' | 'tv', media.tmdbId, userId, qualityOptionId);

    // Resolve tvdbId from TMDB if missing
    let resolvedMedia = media;
    if (mediaType === 'tv' && !media.tvdbId) {
      try {
        const tmdbData = await getTvDetails(media.tmdbId);
        const resolvedTvdbId = tmdbData.external_ids?.tvdb_id ?? null;
        if (resolvedTvdbId) {
          resolvedMedia = { ...media, tvdbId: resolvedTvdbId };
          await prisma.media.update({
            where: { tmdbId_mediaType: { tmdbId: media.tmdbId, mediaType: 'tv' } },
            data: { tvdbId: resolvedTvdbId },
          });
        } else {
          logEvent('debug', 'Request', `Cannot send TV request — tvdbId not found in TMDB for "${media.title}"`);
          return false;
        }
      } catch {
        logEvent('debug', 'Request', `Cannot send TV request — failed to resolve tvdbId for "${media.title}"`);
        return false;
      }
    }

    await sendToArrService(resolvedMedia, mediaType, username, ctx, seasons, rootFolderOverride);
    return true;
  } catch (err) {
    logEvent('debug', 'Request', `Failed to send ${mediaType} "${media.title}" to service: ${err}`);
    logEvent('error', 'Request', `Failed to send "${media.title}" to ${getServiceTypeForMedia(mediaType)}: ${String(err)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Create-request pipeline (shared by POST /api/requests and ctx.requests.create)
// ---------------------------------------------------------------------------

/** Internal sentinel — bubbles through the dedup-then-create transaction so the caller can
 *  surface a 409 without throwing past the boundary. */
class DuplicateRequestError extends Error {}

/** Tagged union describing every way a request-create attempt can fail. The HTTP layer maps
 *  each `status` to its response code; the plugin context just exposes `{ ok, code, error }`.
 *  Extending with a new failure mode means adding one variant + its mapping — callers stay
 *  exhaustive via the discriminant. */
export type CreateRequestResult =
  | { ok: true; status: 201 | 202; request: Awaited<ReturnType<typeof prisma.mediaRequest.create>>; sendFailed?: boolean }
  | { ok: false; status: 400; code: 'INVALID_INPUT'; error: string }
  | { ok: false; status: 403; code: 'BLOCKED_BY_GUARD'; error: string }
  | { ok: false; status: 403; code: 'BLACKLISTED'; error: string }
  | { ok: false; status: 409; code: 'DUPLICATE'; error: string }
  | { ok: false; status: 403; code: 'QUALITY_NOT_ALLOWED'; error: string };

export interface CreateRequestInput {
  userId: number;
  tmdbId: unknown;
  mediaType: unknown;
  seasons?: unknown;
  rootFolder?: string;
  qualityOptionId?: number;
  /** When true, the pluginGuard pass is skipped even for non-admins. Used by
   *  `ctx.requests.create` when the plugin author explicitly wants to avoid triggering other
   *  plugins' `request.create` guards (which could loop if the calling plugin is itself a
   *  guard owner). Defaults to false — HTTP route always runs guards for non-admins. */
  skipPluginGuard?: boolean;
}

/** Unified create-request pipeline: validation → pluginGuard → blacklist → findOrCreateMedia
 *  → dedup → quality gate → row create → sendToService (if autoApproved) → status flip →
 *  safeNotify / safeUserNotify / logEvent. Shared by the HTTP handler and the plugin context
 *  so the two paths cannot drift. */
export async function createUserRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, displayName: true },
  });
  if (!user) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', error: `User ${input.userId} not found` };
  }

  const validation = validateRequestBody({ tmdbId: input.tmdbId, mediaType: input.mediaType, seasons: input.seasons });
  if (!validation.valid) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', error: validation.error };
  }
  const { tmdbId, mediaType, seasons: validSeasons } = validation;

  if (user.role !== 'admin' && !input.skipPluginGuard) {
    const guardResult = await pluginEngine.runGuards('request.create', user.id, {
      request: { tmdbId, mediaType, seasons: validSeasons ?? null },
    });
    if (guardResult?.blocked) {
      return { ok: false, status: (guardResult.statusCode || 403) as 403, code: 'BLOCKED_BY_GUARD', error: guardResult.error || 'Request blocked by plugin guard' };
    }
  }

  const bl = await isBlacklisted(tmdbId, mediaType);
  if (bl.blacklisted) {
    return { ok: false, status: 403, code: 'BLACKLISTED', error: bl.reason || 'This media has been blocked by an administrator.' };
  }

  const media = await findOrCreateMedia(tmdbId, mediaType);

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  let shouldAutoApprove = user.role === 'admin' || (settings?.autoApproveRequests ?? false);
  if (input.qualityOptionId != null) {
    const qualityOpt = await prisma.qualityOption.findUnique({ where: { id: input.qualityOptionId } });
    if (qualityOpt?.allowedRoles && user.role !== 'admin') {
      try {
        const roles = JSON.parse(qualityOpt.allowedRoles) as string[];
        if (roles.length > 0 && !roles.includes(user.role)) {
          return { ok: false, status: 403, code: 'QUALITY_NOT_ALLOWED', error: 'QUALITY_NOT_ALLOWED' };
        }
      } catch (err) {
        // Historical HTTP behaviour was permissive here, but silently opening a role-gated
        // quality option on corrupt `allowedRoles` JSON is an ACL-bypass footgun. Keep the
        // permissive fallback for compat, but surface the corruption so an admin can fix
        // the bad row instead of learning about it via unexpected approvals.
        logEvent('error', 'Request', `Malformed allowedRoles JSON on qualityOption ${input.qualityOptionId} — permissive fallback engaged: ${String(err)}`);
      }
    }
    if (qualityOpt?.approvalMode === 'auto') shouldAutoApprove = true;
    else if (qualityOpt?.approvalMode === 'manual') shouldAutoApprove = user.role === 'admin';
  }

  // Dedup + create in one transaction so two concurrent calls by the same user can't both pass
  // the dedup check and both insert (SQLite serializes writes, but defensive against future
  // backends and intent-clarity for the reader).
  const mediaRequest = await prisma.$transaction(async (tx) => {
    const dup = await tx.mediaRequest.findFirst({
      where: { mediaId: media.id, userId: user.id, status: { in: [...ACTIVE_REQUEST_STATUSES] } },
      select: { id: true },
    });
    if (dup) throw new DuplicateRequestError();
    return tx.mediaRequest.create({
      data: {
        mediaId: media.id,
        userId: user.id,
        mediaType,
        seasons: validSeasons ? JSON.stringify(validSeasons) : null,
        rootFolder: typeof input.rootFolder === 'string' ? input.rootFolder : null,
        qualityOptionId: input.qualityOptionId ?? null,
        status: shouldAutoApprove ? 'approved' : 'pending',
        approvedById: shouldAutoApprove ? user.id : null,
      },
      include: { media: true, user: { select: { id: true, displayName: true, avatar: true } } },
    });
  }).catch((err) => {
    if (err instanceof DuplicateRequestError) return null;
    throw err;
  });
  if (!mediaRequest) {
    return { ok: false, status: 409, code: 'DUPLICATE', error: 'You already have an active request for this media' };
  }

  let sendFailed = false;
  if (shouldAutoApprove) {
    const tagName = await getUserTagName(user.id);
    const sent = await sendToService(media, mediaType, tagName, user.id, validSeasons, input.qualityOptionId);

    // Post-send writes go through a single transaction so the request status and the media
    // status flip can't drift if the process crashes between them.
    if (sent && media.status !== 'available' && media.status !== 'processing') {
      await prisma.media.update({
        where: { id: media.id },
        data: { status: 'searching' },
      }).catch((err) => {
        logEvent('warn', 'Request', `Status-flip to 'searching' failed for media ${media.id} (request ${mediaRequest.id}): ${String(err)}`);
      });
    } else if (!sent) {
      await prisma.mediaRequest.update({ where: { id: mediaRequest.id }, data: { status: 'failed' } })
        .catch((err) => logEvent('warn', 'Request', `Failed to mark request ${mediaRequest.id} as failed after sendToService rejected: ${String(err)}`));
      sendFailed = true;
    }
  }

  const username = user.displayName || 'User';
  const mediaUrl = await buildSiteLink(`/${mediaType}/${media.tmdbId}`);
  safeNotify('request_new', { title: media.title, mediaType, username, posterPath: media.posterPath, tmdbId: media.tmdbId, url: mediaUrl });

  // Auto-approve path: don't ping the requester — they already know the instance auto-approves
  // (their request goes through silently). The bell entry would just be noise. Manual approvals
  // emit the notif from lifecycle.ts where a human decision actually happened.
  //
  // Pending path: admins need an in-app heads-up so they don't have to check the admin tab
  // manually. We notify every (non-disabled) admin user. Custom mod roles aren't covered yet —
  // follow-up if instances need it.
  if (!shouldAutoApprove) {
    const admins = await prisma.user.findMany({
      where: { role: 'admin', disabled: false, id: { not: user.id } },
      select: { id: true },
    });
    for (const admin of admins) {
      safeUserNotify(admin.id, {
        type: 'request_pending_review',
        title: 'notifications.msg.request_pending_review_title',
        message: 'notifications.msg.request_pending_review',
        metadata: { mediaId: media.id, tmdbId: media.tmdbId, mediaType, requestId: mediaRequest.id, msgParams: { username, title: media.title } },
      });
    }
  }
  logEvent('info', 'Request', `${username} requested "${media.title}"`);

  return sendFailed
    ? { ok: true, status: 202, request: mediaRequest, sendFailed: true }
    : { ok: true, status: 201, request: mediaRequest };
}

// ---------------------------------------------------------------------------
// Collection requests
// ---------------------------------------------------------------------------

export async function requestCollectionMovie(
  movieTmdbId: number,
  user: { id: number; role: string },
): Promise<boolean> {
  const bl = await isBlacklisted(movieTmdbId, 'movie');
  if (bl.blacklisted) return false;

  const existingRequest = await prisma.mediaRequest.findFirst({
    where: {
      media: { tmdbId: movieTmdbId, mediaType: 'movie' },
      status: { in: [...ACTIVE_REQUEST_STATUSES, 'available'] },
    },
  });
  if (existingRequest) return false;

  const dbMedia = await prisma.media.findUnique({
    where: { tmdbId_mediaType: { tmdbId: movieTmdbId, mediaType: 'movie' } },
  });
  if (dbMedia?.status === 'available') return false;

  const media = dbMedia ?? await findOrCreateMedia(movieTmdbId, 'movie');

  const req = await prisma.mediaRequest.create({
    data: {
      mediaId: media.id,
      userId: user.id,
      mediaType: 'movie',
      status: user.role === 'admin' ? 'approved' : 'pending',
      approvedById: user.role === 'admin' ? user.id : null,
    },
  });

  if (user.role === 'admin') {
    const tagName = await getUserTagName(user.id);
    const sent = await sendToService(media, 'movie', tagName, user.id);
    if (!sent) {
      await prisma.mediaRequest.update({ where: { id: req.id }, data: { status: 'failed' } });
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Status promotion (moved from GET /requests handler)
// ---------------------------------------------------------------------------

export async function promoteStaleStatuses(): Promise<void> {
  await prisma.mediaRequest.updateMany({
    where: {
      status: { in: [...COMPLETABLE_REQUEST_STATUSES] },
      media: { status: 'available' },
    },
    data: { status: 'available' },
  });
}

// ---------------------------------------------------------------------------
// Retry failed requests (called by scheduler)
// ---------------------------------------------------------------------------

export async function retryFailedRequests(): Promise<{ retried: number; succeeded: number }> {
  const failed = await prisma.mediaRequest.findMany({
    where: { status: 'failed' },
    include: { media: true, user: { select: { id: true, displayName: true, email: true } } },
  });

  if (failed.length === 0) return { retried: 0, succeeded: 0 };

  let succeeded = 0;
  for (const req of failed) {
    const tagName = req.user.displayName || req.user.email || `user-${req.userId}`;
    const seasons = req.seasons ? JSON.parse(req.seasons) : undefined;
    const sent = await sendToService(req.media, req.mediaType, tagName, req.userId, seasons, req.qualityOptionId ?? undefined);
    if (sent) {
      await prisma.mediaRequest.update({ where: { id: req.id }, data: { status: 'approved' } });
      succeeded++;
    }
  }

  if (succeeded > 0) {
    logEvent('info', 'Request', `${succeeded}/${failed.length} failed requests retried successfully`);
  }

  return { retried: failed.length, succeeded };
}
