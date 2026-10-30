interface DownloadIdentity { tmdbId: number; mediaType: string; serviceId?: number }

export function downloadSubscriptionKey(tmdbId: number, mediaType?: string, serviceId?: number): string {
  return `${mediaType ?? '*'}:${tmdbId}:${serviceId ?? '*'}`;
}

/** Preserve global subscribers, while instance-bound detail pages can finish independently. */
export function activeDownloadKeys(downloads: DownloadIdentity[]): Set<string> {
  const keys = new Set<string>();
  for (const item of downloads) {
    keys.add(downloadSubscriptionKey(item.tmdbId));
    keys.add(downloadSubscriptionKey(item.tmdbId, item.mediaType));
    if (item.serviceId !== undefined) {
      keys.add(downloadSubscriptionKey(item.tmdbId, undefined, item.serviceId));
      keys.add(downloadSubscriptionKey(item.tmdbId, item.mediaType, item.serviceId));
    }
  }
  return keys;
}
