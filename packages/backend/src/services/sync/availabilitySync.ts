import { prisma } from '../../utils/prisma.js';
import { getArrClient, arrIdFieldForClient } from '../../providers/index.js';
import { getServiceConfig } from '../../utils/services.js';
import { logEvent } from '../../utils/logEvent.js';

export async function syncAvailabilityDates(since?: Date | null): Promise<{ radarrUpdated: number; sonarrUpdated: number }> {
  let radarrUpdated = 0;
  let sonarrUpdated = 0;

  try {
    radarrUpdated = await syncServiceAvailability('radarr', since ?? null);
  } catch (err) {
    logEvent('debug', 'Sync', `Radarr availability sync failed: ${err}`);
  }

  try {
    sonarrUpdated = await syncServiceAvailability('sonarr', since ?? null);
  } catch (err) {
    logEvent('debug', 'Sync', `Sonarr availability sync failed: ${err}`);
  }

  return { radarrUpdated, sonarrUpdated };
}

async function syncServiceAvailability(serviceType: string, since: Date | null): Promise<number> {
  const config = await getServiceConfig(serviceType);
  if (!config) return 0;

  try {
    const client = await getArrClient(serviceType);
    const entries = await client.getHistoryEntries(since);

    // Deduplicate: keep latest date per serviceMediaId
    const latestByMediaId = new Map<number, { date: Date; extraData?: Record<string, unknown> }>();
    for (const entry of entries) {
      const existing = latestByMediaId.get(entry.serviceMediaId);
      if (!existing || entry.date > existing.date) {
        latestByMediaId.set(entry.serviceMediaId, { date: entry.date, extraData: entry.extraData });
      }
    }

    let updated = 0;
    const idField = arrIdFieldForClient(client);
    for (const [serviceMediaId, { date, extraData }] of latestByMediaId) {
      const result = await prisma.media.updateMany({
        where: {
          [idField]: serviceMediaId,
          OR: [
            { availableAt: null },
            { availableAt: { lt: date } },
          ],
        },
        data: {
          availableAt: date,
          ...(extraData?.episode ? { lastEpisodeInfo: JSON.stringify(extraData.episode) } : {}),
        },
      });
      updated += result.count;
    }

    logEvent('debug', 'Sync', `${serviceType} availability: ${entries.length} history events -> ${updated} media updated`);
    return updated;
  } catch (err) {
    logEvent('debug', 'Sync', `${serviceType} availability sync failed: ${err}`);
    return 0;
  }
}
