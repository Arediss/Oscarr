import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { getAppSettings } from '../utils/appSettings.js';
import { getArrClient, getServiceDefinition, arrIdFieldForService } from '../providers/index.js';
import { promoteMediaToAvailable, findMediaByExternalId, cascadeRequestsForCategory } from '../services/mediaService.js';
import { sendAvailabilityNotifications } from '../services/sync/helpers.js';
import { logEvent } from '../utils/logEvent.js';

function sanitize(input: string): string {
  return input.replaceAll(/[\r\n\t]/g, '');
}

type ArrClient = Awaited<ReturnType<typeof getArrClient>>;
type WebhookEvent = NonNullable<ReturnType<NonNullable<ArrClient['parseWebhookPayload']>>>;
type TrackedMedia = NonNullable<Awaited<ReturnType<typeof findMediaByExternalId>>>;

/** Reply shape shared by every branch: the *arr only cares that it got a 2xx. */
type Ack = { ok: true; message?: string };

// ─── Authentication ─────────────────────────────────────────────────

/** Header, query param, or Basic Auth password — Radarr and Sonarr each use a different one. */
function readApiKey(request: FastifyRequest): string | undefined {
  const direct = (request.headers['x-api-key'] as string)
    || (request.query as Record<string, string>).apikey;
  if (direct) return direct;

  const auth = request.headers.authorization;
  if (!auth?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colonIdx = decoded.indexOf(':');
  return colonIdx === -1 ? undefined : decoded.slice(colonIdx + 1) || undefined;
}

/** Null when authenticated; otherwise the status + body to reply with. */
async function authFailure(request: FastifyRequest): Promise<{ status: number; error: string } | null> {
  const apiKey = readApiKey(request);
  if (!apiKey) return { status: 401, error: 'API key required' };

  const settings = await getAppSettings();
  if (!settings?.apiKey) return { status: 403, error: 'No API key configured' };

  const provided = Buffer.from(apiKey);
  const stored = Buffer.from(settings.apiKey);
  if (provided.length !== stored.length || !crypto.timingSafeEqual(provided, stored)) {
    return { status: 403, error: 'Invalid API key' };
  }
  return null;
}

/** A client good enough to parse a payload, even when no such service is configured yet. */
async function resolveClient(serviceType: string): Promise<ArrClient | null> {
  const def = getServiceDefinition(serviceType);
  if (!def?.createClient) return null;
  try {
    return await getArrClient(serviceType);
  } catch {
    // parseWebhookPayload needs no connection, so an unconfigured service can still be understood.
    return def.createClient({ url: '', apiKey: '' });
  }
}

// ─── Event handlers ─────────────────────────────────────────────────

/** True when the *arr id should be written: we have one and the row has none yet. */
function shouldBackfillArrId(media: TrackedMedia, arrIdField: string | null, internalId?: number): arrIdField is string {
  if (!arrIdField || internalId === undefined || internalId <= 0) return false;
  return (media as Record<string, unknown>)[arrIdField] == null;
}

/** Grab = the *arr started downloading → PROCESSING, backfilling its id when missing. */
async function handleGrab(serviceType: string, client: ArrClient, event: WebhookEvent): Promise<Ack> {
  const media = await findMediaByExternalId(client.mediaType, event.externalId);
  if (media && media.statusCategory !== 'AVAILABLE') {
    const arrIdField = arrIdFieldForService(serviceType);
    const wasProcessing = media.statusCategory === 'PROCESSING';
    try {
      // Transactional update+cascade pair (same as mediaSync.applyUpdate): a failure between the
      // two writes would strand requests at 'approved' behind the wasProcessing guard.
      await prisma.$transaction(async (tx) => {
        await tx.media.update({
          where: { id: media.id },
          data: {
            statusCategory: 'PROCESSING',
            ...(shouldBackfillArrId(media, arrIdField, event.internalId)
              ? { [arrIdField]: event.internalId }
              : {}),
          },
        });
        // Grab means the *arr picked it up — flip approved/failed requests to processing too.
        if (!wasProcessing) await cascadeRequestsForCategory(media.id, 'PROCESSING', tx);
      });
    } catch (err) {
      logEvent('warn', 'Webhook', `grab → PROCESSING failed for media ${media.id}: ${String(err)}`);
    }
  }
  logEvent('info', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" grabbed → processing`);
  return { ok: true };
}

/** Poster/quality/seasons in one call — without it the row rendered an empty card until the next
 *  periodic sync (~15 min). */
async function enrich(client: ArrClient, internalId?: number) {
  if (!internalId || internalId <= 0 || !client.getMediaById) return null;
  return client.getMediaById(internalId).catch((err) => {
    logEvent('warn', 'Webhook', `getMediaById failed for ${internalId}: ${String(err)}`);
    return null;
  });
}

async function backfillSeasons(mediaId: number, enriched: Awaited<ReturnType<typeof enrich>>): Promise<void> {
  if (!enriched?.seasons?.length) return;
  await prisma.season.createMany({
    data: enriched.seasons
      .filter((s) => s.seasonNumber > 0)
      .map((s) => ({
        mediaId,
        seasonNumber: s.seasonNumber,
        episodeCount: s.totalEpisodeCount,
        statusCategory: s.statusCategory,
      })),
  }).catch((err) => {
    logEvent('warn', 'Webhook', `Season backfill failed for media ${mediaId}: ${String(err)}`);
  });
}

async function handleAdded(serviceType: string, client: ArrClient, event: WebhookEvent): Promise<Ack> {
  const mediaType = client.mediaType;
  if (await findMediaByExternalId(mediaType, event.externalId)) return { ok: true };

  const arrIdField = arrIdFieldForService(serviceType);
  const enriched = await enrich(client, event.internalId);
  // A series with no resolvable TMDB id gets a negative placeholder keyed on its TVDB id; the
  // real id lands when the media is next synced.
  const realTmdbId = mediaType === 'tv'
    ? (enriched?.tmdbId && enriched.tmdbId > 0 ? enriched.tmdbId : -event.externalId)
    : event.externalId;

  const created = await prisma.media.create({
    data: {
      tmdbId: realTmdbId,
      ...(mediaType === 'tv' ? { tvdbId: event.externalId } : {}),
      mediaType,
      title: enriched?.title ?? sanitize(event.title),
      statusCategory: 'SEARCHING',
      posterPath: enriched?.posterPath ?? null,
      backdropPath: enriched?.backdropPath ?? null,
      qualityProfileId: enriched?.qualityProfileId ?? null,
      ...(arrIdField && event.internalId !== undefined && event.internalId > 0
        ? { [arrIdField]: event.internalId }
        : {}),
    },
  });

  if (mediaType === 'tv') await backfillSeasons(created.id, enriched);
  logEvent('info', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" added — created in Oscarr`);
  return { ok: true };
}

async function handleDeleted(serviceType: string, client: ArrClient, event: WebhookEvent): Promise<Ack> {
  const media = await findMediaByExternalId(client.mediaType, event.externalId);
  if (media?.statusCategory === 'AVAILABLE') {
    await prisma.media.update({ where: { id: media.id }, data: { statusCategory: 'UNAVAILABLE' } });
    logEvent('info', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" deleted from service`);
    logEvent('debug', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" deleted`);
  }
  return { ok: true };
}

/** The *arr id is what "Recently added" filters on; a webhook-only media without it never shows. */
async function backfillArrId(serviceType: string, media: TrackedMedia, internalId?: number): Promise<void> {
  const arrIdField = arrIdFieldForService(serviceType);
  if (!shouldBackfillArrId(media, arrIdField, internalId)) return;
  await prisma.media.update({
    where: { id: media.id },
    data: { [arrIdField]: internalId },
  }).catch((err) => {
    logEvent('warn', 'Webhook', `Failed to backfill ${arrIdField}=${internalId} on media ${media.id}: ${String(err)}`);
  });
}

async function handleDownload(serviceType: string, client: ArrClient, event: WebhookEvent): Promise<Ack> {
  const mediaType = client.mediaType;
  const media = await findMediaByExternalId(mediaType, event.externalId);
  if (!media) {
    logEvent('debug', 'Webhook', `${sanitize(serviceType)} download event for unknown media: ${sanitize(event.title)} (${event.externalId})`);
    return { ok: true, message: 'Media not tracked' };
  }

  if (media.statusCategory !== 'AVAILABLE') {
    await promoteMediaToAvailable(media.id, !!media.availableAt);
    sendAvailabilityNotifications(
      media.title || sanitize(event.title),
      mediaType,
      media.posterPath,
      media.id,
      media.tmdbId,
    );
    logEvent('info', 'Webhook', `"${sanitize(event.title)}" is now available (via ${sanitize(serviceType)} webhook)`);
    logEvent('debug', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" now available`);
  }

  await backfillArrId(serviceType, media, event.internalId);
  return { ok: true, message: 'Media updated' };
}

const HANDLERS: Record<string, (serviceType: string, client: ArrClient, event: WebhookEvent) => Promise<Ack>> = {
  grab: handleGrab,
  added: handleAdded,
  deleted: handleDeleted,
  download: handleDownload,
};

// ─── Route ──────────────────────────────────────────────────────────

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/:serviceType', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const { serviceType } = request.params as { serviceType: string };

    const failure = await authFailure(request);
    if (failure) return reply.status(failure.status).send({ error: failure.error });

    const client = await resolveClient(serviceType);
    if (!client) return reply.status(400).send({ error: `Unknown service type: ${sanitize(serviceType)}` });
    if (!client.parseWebhookPayload) {
      return reply.status(400).send({ error: `Service ${sanitize(serviceType)} does not support webhooks` });
    }

    const event = client.parseWebhookPayload(request.body);
    if (!event) return reply.send({ ok: true, message: 'Payload ignored' });

    if (event.type === 'test') {
      logEvent('debug', 'Webhook', `${sanitize(serviceType)} test received`);
      logEvent('info', 'Webhook', `${sanitize(serviceType)} webhook test successful`);
      return reply.send({ ok: true, message: 'Webhook configured successfully' });
    }

    // Everything below acts on a specific title, so an unusable id is nothing to act on.
    if (!event.externalId || event.externalId <= 0) {
      return reply.send({ ok: true, message: 'Invalid externalId, skipped' });
    }

    // Unknown event types are acknowledged silently — an *arr that sends one must not see an error.
    const handler = HANDLERS[event.type];
    return reply.send(handler ? await handler(serviceType, client, event) : { ok: true });
  });
}
