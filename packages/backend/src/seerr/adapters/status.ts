/**
 * Mirrors Overseerr's `/api/v1/status` SystemResource shape. We pin a known-good Overseerr
 * version so clients that gate features by `version` (Maintainerr, mobile apps) treat us as a
 * recent-enough server. Bump together with the upstream version we've validated against.
 */
const SPOOFED_OVERSEERR_VERSION = '1.34.0';
const SPOOFED_COMMIT_TAG = 'oscarr-compat';

export interface SeerrStatus {
  version: string;
  commitTag: string;
  updateAvailable: boolean;
  commitsBehind: number;
  restartRequired: boolean;
}

export function buildStatusResponse(): SeerrStatus {
  return {
    version: SPOOFED_OVERSEERR_VERSION,
    commitTag: SPOOFED_COMMIT_TAG,
    updateAvailable: false,
    commitsBehind: 0,
    restartRequired: false,
  };
}
