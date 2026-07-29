import { prisma } from '../../utils/prisma.js';
import { getArrClientForService, arrIdFieldForClient } from '../../providers/index.js';
import type { ArrClient } from '../../providers/types.js';
import { getAllServices } from '../../utils/services.js';
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
  const services = await getAllServices(serviceType);
  if (services.length === 0) return 0;

  let total = 0;
  for (const service of services) {
    total += await syncOneServiceAvailability(
      getArrClientForService(service.id, serviceType, service.config),
      service.id,
      serviceType,
      since,
    );
  }
  return total;
}

/** Scoped by serviceId: two instances can hold the same radarrId for different titles. */
async function syncOneServiceAvailability(
  client: ArrClient,
  serviceId: number,
  serviceType: string,
  since: Date | null,
): Promise<number> {
  try {
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
          // Sibling OR keys would overwrite each other — AND them explicitly.
          AND: [
            { OR: [{ serviceId }, { serviceId: null }] },
            { OR: [{ availableAt: null }, { availableAt: { lt: date } }] },
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
