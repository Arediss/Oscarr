/**
 * Pull deployment-shape info from a Seerr-family source (services + locale + region) so
 * the install wizard's Migrate path can seed Oscarr's config without re-asking the user.
 *
 * Pure read — never writes. The Plex token is not exposed by the Seerr API surface, so
 * Plex shows up only as a `plexHint` (URL) and lands in `manualFollowUps`.
 */

interface SourceCreds {
  url: string;
  apiKey: string;
}

interface SeerrStatus {
  version?: string;
}

interface SeerrArrInstance {
  id?: number;
  name?: string;
  hostname?: string;
  port?: number;
  baseUrl?: string;
  useSsl?: boolean;
  activeProfileName?: string;
  activeProfileId?: number;
  activeDirectory?: string;
  isDefault?: boolean;
}

interface SeerrPlexSettings {
  ip?: string;
  hostname?: string;
  port?: number;
  useSsl?: boolean;
}

interface SeerrMainSettings {
  applicationTitle?: string;
  applicationUrl?: string;
  locale?: string;
  region?: string;
  originalLanguage?: string;
}

export interface DerivedConfig {
  reachable: boolean;
  version?: string;
  locale?: string;
  region?: string;
  radarr: Array<{ url: string; profile?: string; rootFolder?: string }>;
  sonarr: Array<{ url: string; profile?: string; rootFolder?: string }>;
  plexHint?: { url?: string };
  manualFollowUps: string[];
}

function trim(url: string): string {
  // Backwards scan rather than /\/+$/: the regex backtracks polynomially on a long run of
  // trailing slashes, which an admin-supplied URL can contain.
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

/** `fetch` has no default timeout: a source that accepts the connection then stalls would hang
 *  the config probe — and the import wizard behind it — with nothing to cancel. */
const PROBE_TIMEOUT_MS = 15_000;

async function getJson<T>(creds: SourceCreds, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${trim(creds.url)}${path}`, {
      headers: { Accept: 'application/json', 'X-Api-Key': creds.apiKey },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function arrUrl(inst: SeerrArrInstance): string {
  const proto = inst.useSsl ? 'https' : 'http';
  const host = inst.hostname || '';
  const port = inst.port ? `:${inst.port}` : '';
  const base = inst.baseUrl ? `/${inst.baseUrl.replace(/^\/+|\/+$/g, '')}` : '';
  return `${proto}://${host}${port}${base}`;
}

function plexUrl(p: SeerrPlexSettings): string | undefined {
  const host = p.hostname || p.ip;
  if (!host) return undefined;
  const proto = p.useSsl ? 'https' : 'http';
  const port = p.port ? `:${p.port}` : '';
  return `${proto}://${host}${port}`;
}

export async function deriveConfigFromSeerr(creds: SourceCreds): Promise<DerivedConfig> {
  const status = await getJson<SeerrStatus>(creds, '/api/v1/status');
  if (!status?.version) {
    return { reachable: false, radarr: [], sonarr: [], manualFollowUps: [] };
  }

  const [main, radarrSettings, sonarrSettings, plexSettings] = await Promise.all([
    getJson<SeerrMainSettings>(creds, '/api/v1/settings/main'),
    getJson<SeerrArrInstance[]>(creds, '/api/v1/settings/radarr'),
    getJson<SeerrArrInstance[]>(creds, '/api/v1/settings/sonarr'),
    getJson<SeerrPlexSettings>(creds, '/api/v1/settings/plex'),
  ]);

  const followUps: string[] = [];

  const radarr = (radarrSettings ?? []).map((r) => ({
    url: arrUrl(r),
    profile: r.activeProfileName,
    rootFolder: r.activeDirectory,
  }));
  const sonarr = (sonarrSettings ?? []).map((s) => ({
    url: arrUrl(s),
    profile: s.activeProfileName,
    rootFolder: s.activeDirectory,
  }));

  if (radarr.length === 0) followUps.push('No Radarr instance found at the source — add one in Oscarr Admin > Services.');
  if (sonarr.length === 0) followUps.push('No Sonarr instance found at the source — add one in Oscarr Admin > Services.');

  // *arr API keys are not exposed by Seerr settings endpoints — caller must re-enter them
  // in the wizard's Services step or accept that Oscarr won't be able to talk to them.
  if (radarr.length > 0 || sonarr.length > 0) {
    followUps.push('Radarr/Sonarr API keys are not exported by Seerr — re-enter them in Admin > Services after install.');
  }

  let plexHint: DerivedConfig['plexHint'];
  if (plexSettings) {
    const url = plexUrl(plexSettings);
    if (url) {
      plexHint = { url };
      followUps.push('Plex token is not exported by Seerr — re-link Plex in Admin > Services to enable Plex sync.');
    }
  }

  return {
    reachable: true,
    version: status.version,
    locale: main?.locale,
    region: main?.region,
    radarr,
    sonarr,
    plexHint,
    manualFollowUps: followUps,
  };
}
