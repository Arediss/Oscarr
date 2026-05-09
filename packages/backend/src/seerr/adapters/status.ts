/**
 * Compatibility response for clients that expect an Overseerr-shaped /status payload.
 * The numeric `version` mirrors a known-good Overseerr release so clients that gate features
 * by it (Maintainerr, mobile apps) treat us as recent enough — but `appName` is `Oscarr` and
 * `compatibility` makes the layer's intent explicit. This is interoperability, not impersonation;
 * Oscarr is not affiliated with Overseerr / Jellyseerr / Seerr.
 */
const COMPAT_VERSION = '1.34.0';
const COMPAT_COMMIT_TAG = 'oscarr-seerr-compat';

export interface SeerrStatus {
  version: string;
  commitTag: string;
  updateAvailable: boolean;
  commitsBehind: number;
  restartRequired: boolean;
  appName: string;
  compatibility: string;
}

export function buildStatusResponse(): SeerrStatus {
  return {
    version: COMPAT_VERSION,
    commitTag: COMPAT_COMMIT_TAG,
    updateAvailable: false,
    commitsBehind: 0,
    restartRequired: false,
    appName: 'Oscarr',
    compatibility: 'overseerr',
  };
}
