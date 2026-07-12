import { getAppSettings } from '../../utils/appSettings.js';
import { syncArrService } from './mediaSync.js';
import { syncAvailabilityDates } from './availabilitySync.js';
import type { SyncResult } from './helpers.js';

// ---------------------------------------------------------------------------
// Full / incremental sync orchestrators
// ---------------------------------------------------------------------------

export async function runNewMediaSync(): Promise<{ radarr: SyncResult; sonarr: SyncResult }> {
  const settings = await getAppSettings();
  // Sequential to avoid SQLite write lock contention
  const radarrResult = await syncArrService('radarr', settings?.lastRadarrSync);
  const sonarrResult = await syncArrService('sonarr', settings?.lastSonarrSync);
  // Sync availability dates from history since last sync
  const earliestSync = [settings?.lastRadarrSync, settings?.lastSonarrSync]
    .filter(Boolean)
    .sort((a, b) => a!.getTime() - b!.getTime())[0] || null;
  const avail = await syncAvailabilityDates(earliestSync);
  radarrResult.updated += avail.radarrUpdated;
  sonarrResult.updated += avail.sonarrUpdated;
  return { radarr: radarrResult, sonarr: sonarrResult };
}

export async function runFullSync(): Promise<{ radarr: SyncResult; sonarr: SyncResult }> {
  // Sequential to avoid SQLite write lock contention
  const radarrResult = await syncArrService('radarr', null);
  const sonarrResult = await syncArrService('sonarr', null);
  // After full sync, also sync availability dates from history
  const avail = await syncAvailabilityDates(null);
  radarrResult.updated += avail.radarrUpdated;
  sonarrResult.updated += avail.sonarrUpdated;
  return { radarr: radarrResult, sonarr: sonarrResult };
}

// Re-export everything for backwards compatibility
export { syncArrService } from './mediaSync.js';
export { syncAvailabilityDates } from './availabilitySync.js';
export type { SyncResult } from './helpers.js';
export { syncMissingKeywords, trackKeywordsFromDetails } from './keywordSync.js';
