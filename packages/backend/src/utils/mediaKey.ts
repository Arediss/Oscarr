/** Stable composite key for a media row across caches and lookups. */
export function mediaKey(m: { tmdbId: number; mediaType: string }): string {
  return `${m.mediaType}:${m.tmdbId}`;
}
