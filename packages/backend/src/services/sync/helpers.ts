import { prisma } from '../../utils/prisma.js';
import { safeNotify, safeUserNotify, getInstanceLocale } from '../../utils/safeNotify.js';
import { COMPLETABLE_REQUEST_STATUSES, renderNotificationTemplate } from '@oscarr/shared';
import type { PluginMediaAvailableV1 } from '@oscarr/shared';
import { sendPushToUsers } from '../pushService.js';
import { pluginEventBus } from '../../plugins/eventBus.js';
import { logEvent } from '../../utils/logEvent.js';

export interface SyncResult {
  added: number;
  updated: number;
  errors: number;
  duration: number;
}

/** Users whose request a transition to available would complete.
 *
 *  Read this BEFORE promoting the media: the promotion cascade flips exactly those rows to
 *  `available`, so asking afterwards returns nobody and every channel goes quiet. */
export async function findAvailabilityRecipients(mediaId: number): Promise<number[]> {
  const requests = await prisma.mediaRequest.findMany({
    where: { mediaId, status: { in: [...COMPLETABLE_REQUEST_STATUSES] } },
    select: { userId: true },
  });
  return [...new Set(requests.map((r) => r.userId))];
}

/** Fan out "it's here" across in-app, push, plugin and external channels.
 *
 *  `recipientUserIds` is for callers that promote the media first — they must capture the
 *  requesters beforehand and hand them over, otherwise the lookup here comes back empty. */
export function sendAvailabilityNotifications(
  title: string,
  mediaType: 'movie' | 'tv',
  posterPath: string | null,
  mediaId: number,
  tmdbId: number,
  recipientUserIds?: number[],
): void {
  // Skip when no Oscarr user has an active request — direct *arr imports shouldn't trigger
  // external channels for media nobody asked for.
  (recipientUserIds ? Promise.resolve(recipientUserIds) : findAvailabilityRecipients(mediaId)).then(async userIds => {
    if (userIds.length === 0) return;

    safeNotify('media_available', { title, mediaType, posterPath });

    const event: PluginMediaAvailableV1 = {
      v: 1,
      mediaId,
      tmdbId,
      mediaType,
      title,
      posterPath,
      requesterUserIds: userIds,
    };
    pluginEventBus.emit('media.available', event).catch(err => {
      logEvent('error', 'PluginEvent', `Subscriber of 'media.available' threw: ${String(err)}`);
    });

    for (const userId of userIds) {
      safeUserNotify(userId, {
        type: 'media_available',
        title,
        message: 'notifications.msg.media_available',
        metadata: { mediaId, tmdbId, mediaType, posterPath, msgParams: { title } },
      });
    }

    const icon = posterPath ? `https://image.tmdb.org/t/p/w200${posterPath}` : undefined;
    const url = tmdbId > 0 ? `/${mediaType}/${tmdbId}` : '/requests';
    // Web push is rendered by the backend (no per-user language stored), so use the instance
    // language via the shared templates — same source as the channel providers.
    const locale = await getInstanceLocale();
    sendPushToUsers(userIds, {
      title: renderNotificationTemplate('notifications.push.media_available.title', locale, { title }),
      body: renderNotificationTemplate('notifications.push.media_available.body', locale),
      icon,
      url,
    }).catch((err) => {
      logEvent('warn', 'Notif', `Web push fan-out failed for media ${mediaId}: ${String(err)}`);
    });
  }).catch((err) => {
    logEvent('error', 'Notif', `sendAvailabilityNotifications failed for media ${mediaId}: ${String(err)}`);
  });
}
