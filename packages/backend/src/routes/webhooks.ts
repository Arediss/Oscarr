import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { getArrClient, getServiceDefinition } from '../providers/index.js';
import { promoteMediaToAvailable, findMediaByExternalId } from '../services/mediaService.js';
import { sendAvailabilityNotifications } from '../services/sync/helpers.js';
import { logEvent } from '../utils/logEvent.js';

function sanitize(input: string): string {
  return input.replaceAll(/[\r\n\t]/g, '');
}

export async function webhookRoutes(app: FastifyInstance) {

  app.post('/:serviceType', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const { serviceType } = request.params as { serviceType: string };

    // 1. Validate API key (X-Api-Key header, query param, or Basic Auth password)
    let apiKey = (request.headers['x-api-key'] as string)
      || (request.query as Record<string, string>).apikey;

    // Support Basic Auth — API key as password (Radarr/Sonarr webhook format)
    if (!apiKey && request.headers.authorization?.startsWith('Basic ')) {
      const decoded = Buffer.from(request.headers.authorization.slice(6), 'base64').toString();
      const colonIdx = decoded.indexOf(':');
      const password = colonIdx !== -1 ? decoded.slice(colonIdx + 1) : '';
      if (password) apiKey = password;
    }

    if (!apiKey) {
      return reply.status(401).send({ error: 'API key required' });
    }

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { apiKey: true } });
    if (!settings?.apiKey) {
      return reply.status(403).send({ error: 'No API key configured' });
    }
    const provided = Buffer.from(apiKey);
    const stored = Buffer.from(settings.apiKey);
    if (provided.length !== stored.length || !crypto.timingSafeEqual(provided, stored)) {
      return reply.status(403).send({ error: 'Invalid API key' });
    }

    // 2. Get provider and parse webhook
    const def = getServiceDefinition(serviceType);
    if (!def?.createClient) {
      return reply.status(400).send({ error: `Unknown service type: ${sanitize(serviceType)}` });
    }

    let client;
    try {
      client = await getArrClient(serviceType);
    } catch {
      // No service configured — create a temp client just for parsing
      // parseWebhookPayload doesn't need a real connection
      client = def.createClient({ url: '', apiKey: '' });
    }

    if (!client.parseWebhookPayload) {
      return reply.status(400).send({ error: `Service ${sanitize(serviceType)} does not support webhooks` });
    }

    const event = client.parseWebhookPayload(request.body);
    if (!event) {
      return reply.send({ ok: true, message: 'Payload ignored' });
    }

    // 3. Handle event
    if (event.type === 'test') {
      logEvent('debug', 'Webhook', `${sanitize(serviceType)} test received`);
      logEvent('info', 'Webhook', `${sanitize(serviceType)} webhook test successful`);
      return reply.send({ ok: true, message: 'Webhook configured successfully' });
    }

    // Validate externalId for actionable events
    if (!event.externalId || event.externalId <= 0) {
      return reply.send({ ok: true, message: 'Invalid externalId, skipped' });
    }

    if (event.type === 'grab') {
      // Grab = *arr started downloading → PROCESSING (+ backfill the internal id if missing).
      const mediaType = client.mediaType;
      const media = await findMediaByExternalId(mediaType, event.externalId);
      if (media && media.statusCategory !== 'AVAILABLE') {
        const arrIdField = serviceType === 'radarr' ? 'radarrId' : serviceType === 'sonarr' ? 'sonarrId' : null;
        await prisma.media.update({
          where: { id: media.id },
          data: {
            statusCategory: 'PROCESSING',
            ...(arrIdField && event.internalId !== undefined && event.internalId > 0 && (media as Record<string, unknown>)[arrIdField] == null
              ? { [arrIdField]: event.internalId }
              : {}),
          },
        }).catch((err) => logEvent('warn', 'Webhook', `grab → PROCESSING failed for media ${media.id}: ${String(err)}`));
      }
      logEvent('info', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" grabbed → processing`);
      return reply.send({ ok: true });
    }

    if (event.type === 'added') {
      const mediaType = client.mediaType;
      const existing = await findMediaByExternalId(mediaType, event.externalId);

      if (!existing) {
        const arrIdField = serviceType === 'radarr' ? 'radarrId' : serviceType === 'sonarr' ? 'sonarrId' : null;
        // Enrich with poster/quality/seasons via getMediaById — without this the row stayed
        // poster-less until next periodic sync (~15 min) and rendered an empty card on /home.
        let enriched: Awaited<ReturnType<typeof client.getMediaById>> = null;
        if (event.internalId && event.internalId > 0 && client.getMediaById) {
          enriched = await client.getMediaById(event.internalId).catch((err) => {
            logEvent('warn', 'Webhook', `getMediaById failed for ${sanitize(serviceType)}:${event.internalId}: ${String(err)}`);
            return null;
          });
        }
        const realTmdbId = mediaType === 'tv'
          ? (enriched?.tmdbId && enriched.tmdbId > 0 ? enriched.tmdbId : -(event.externalId))
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
        if (mediaType === 'tv' && enriched?.seasons?.length) {
          await prisma.season.createMany({
            data: enriched.seasons
              .filter((s) => s.seasonNumber > 0)
              .map((s) => ({
                mediaId: created.id,
                seasonNumber: s.seasonNumber,
                episodeCount: s.totalEpisodeCount,
                statusCategory: s.statusCategory,
              })),
          }).catch((err) => {
            logEvent('warn', 'Webhook', `Season backfill failed for media ${created.id}: ${String(err)}`);
          });
        }
        logEvent('info', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" added — created in Oscarr`);
      }
      return reply.send({ ok: true });
    }

    if (event.type === 'deleted') {
      const mediaType = client.mediaType;
      const media = await findMediaByExternalId(mediaType, event.externalId);

      if (media?.statusCategory === 'AVAILABLE') {
        await prisma.media.update({
          where: { id: media.id },
          data: { statusCategory: 'UNAVAILABLE' },
        });
        logEvent('info', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" deleted from service`);
        logEvent('debug', 'Webhook', `${sanitize(serviceType)}: "${sanitize(event.title)}" deleted`);
      }
      return reply.send({ ok: true });
    }

    if (event.type === 'download') {
      const mediaType = client.mediaType;
      const media = await findMediaByExternalId(mediaType, event.externalId);

      if (!media) {
        logEvent('debug', 'Webhook', `${sanitize(serviceType)} download event for unknown media: ${sanitize(event.title)} (${event.externalId})`);
        return reply.send({ ok: true, message: 'Media not tracked' });
      }

      // Promote to available if not already
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

      // Backfill the *arr internal id when the sync job hasn't populated it (or has been
      // disabled by the admin in favour of webhook-driven updates). Without this, the
      // home's "Recently added" query (which filters on radarrId/sonarrId IS NOT NULL)
      // skips webhook-only media even though they're correctly marked `available`.
      if (event.internalId !== undefined && event.internalId > 0) {
        const arrIdField = serviceType === 'radarr' ? 'radarrId' : serviceType === 'sonarr' ? 'sonarrId' : null;
        if (arrIdField) {
          const current = (media as Record<string, unknown>)[arrIdField];
          if (current === null || current === undefined) {
            await prisma.media.update({
              where: { id: media.id },
              data: { [arrIdField]: event.internalId },
            }).catch((err) => {
              logEvent('warn', 'Webhook', `Failed to backfill ${arrIdField}=${event.internalId} on media ${media.id}: ${String(err)}`);
            });
          }
        }
      }

      return reply.send({ ok: true, message: 'Media updated' });
    }

    // Unknown or unhandled event type — acknowledge silently
    return reply.send({ ok: true });
  });
}
