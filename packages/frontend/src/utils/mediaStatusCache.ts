import type { MediaStateCategory, RequestStatus } from '@oscarr/shared';

export interface MediaStatus {
  statusCategory: MediaStateCategory;
  requestStatus?: RequestStatus;
  hasFreeQualityOption?: boolean;
}

/** Version each key so late batch responses cannot replace a detail update or invalidation. */
export class MediaStatusCache {
  private values = new Map<string, MediaStatus>();
  private times = new Map<string, number>();
  private versions = new Map<string, number>();
  get(key: string) { return this.values.get(key); }
  version(key: string) {
    // Track pending lookups too, so clearing the cache invalidates their responses.
    if (!this.versions.has(key)) this.versions.set(key, 0);
    return this.versions.get(key)!;
  }
  isValid(key: string) { return Date.now() - (this.times.get(key) ?? 0) < 30000; }
  set(key: string, value: MediaStatus) {
    this.values.set(key, value);
    this.times.set(key, Date.now());
    this.versions.set(key, this.version(key) + 1);
  }
  patch(key: string, value: MediaStatus) { this.set(key, { ...this.get(key), ...value }); }
  setIfUnchanged(key: string, version: number, value: MediaStatus) {
    if (this.version(key) === version) this.set(key, value);
  }
  invalidate(key: string) {
    this.values.delete(key);
    this.times.delete(key);
    this.versions.set(key, this.version(key) + 1);
  }
  clear() { for (const key of this.versions.keys()) this.invalidate(key); }
}
