/** Hub for the registry doc + GitHub releases API. Pure — persistence is the route's job. */
import { isUpdateAvailable } from './statusDetection.js';

const REGISTRY_URL = 'https://raw.githubusercontent.com/arediss/Oscarr-Plugin-Registry/main/plugins.json';
const REGISTRY_TTL_MS = 30 * 60 * 1000;
const RELEASE_TTL_MS = 60 * 60 * 1000;
/** Hard cap on any single GitHub call — a hung GitHub mustn't freeze boot or the admin UI. */
const FETCH_TIMEOUT_MS = 5_000;

export interface RegistryEntry {
  repository: string;
  category?: string;
  tags?: string[];
}

export interface RegistryDoc {
  schemaVersion?: number;
  plugins?: RegistryEntry[];
}

export interface GitHubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name: string; browser_download_url: string; download_count?: number }[];
}

export interface UpdateCheckResult {
  installed: string;
  latest: string | null;
  available: boolean;
  repository: string;
}

/** `ok: false` means every plugin failed — caller mustn't cache, or a transient GitHub blip
 *  would lock the update badge for the full TTL. */
export interface UpdateCheckBatch {
  ok: boolean;
  results: Map<string, UpdateCheckResult>;
}

/** Distinguishes "GitHub is throttling us" from "this repo has no release", which the caller
 *  must not confuse: the first is transient and must not be cached or silently fallen back on. */
export class RateLimitError extends Error {}

function isRateLimited(res: Response): boolean {
  if (res.status !== 403 && res.status !== 429) return false;
  return res.headers.get('x-ratelimit-remaining') === '0'
    || res.headers.get('retry-after') !== null;
}

let registryCache: { data: RegistryDoc; timestamp: number } | null = null;
const releaseCache = new Map<string, { rel: GitHubRelease | null; timestamp: number }>();
let inflightUpdateCheck: Promise<UpdateCheckBatch> | null = null;

// ── Registry fetch ──────────────────────────────────────────────────

export async function fetchRegistry(force = false): Promise<RegistryDoc> {
  const now = Date.now();
  if (!force && registryCache && now - registryCache.timestamp < REGISTRY_TTL_MS) {
    return registryCache.data;
  }
  const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Registry fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as RegistryDoc;
  registryCache = { data, timestamp: now };
  return data;
}

// ── GitHub release fetch ────────────────────────────────────────────

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Falls back to /releases sorted by semver when /releases/latest 404s — common when no
 *  release is flagged "latest" on the repo. */
export async function fetchLatestRelease(repository: string, force = false): Promise<GitHubRelease | null> {
  const now = Date.now();
  const cached = releaseCache.get(repository);
  if (!force && cached && now - cached.timestamp < RELEASE_TTL_MS) return cached.rel;

  const headers = githubHeaders();
  const latest = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (latest.ok) {
    const rel = await latest.json() as GitHubRelease;
    releaseCache.set(repository, { rel, timestamp: now });
    return rel;
  }
  // A throttled API is not "this repo has no release". Caching null here would keep every
  // caller on the source-tarball fallback for the full hour, long after the quota resets.
  if (isRateLimited(latest)) {
    throw new RateLimitError(
      'GitHub API rate limit reached (60 requests/hour for unauthenticated servers). '
      + 'Set GITHUB_TOKEN in Oscarr\'s environment to raise it, or retry in a few minutes.',
    );
  }
  if (latest.status === 404) {
    const list = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=30`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (list.ok) {
      const releases = await list.json() as GitHubRelease[];
      const stable = releases.filter((r) => !r.draft && !r.prerelease && r.tag_name);
      if (stable.length > 0) {
        stable.sort((a, b) => compareTagDesc(a.tag_name!, b.tag_name!));
        const rel = stable[0];
        releaseCache.set(repository, { rel, timestamp: now });
        return rel;
      }
    }
  }
  releaseCache.set(repository, { rel: null, timestamp: now });
  return null;
}

export async function fetchRepoMetadata(repository: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repository}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return {};
    return await res.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Fetches `manifest.json` at a given ref (branch or tag). The Discover catalog reads `main`;
 *  the update preflight passes the release tag so the diff matches what will actually install. */
export async function fetchRemoteManifest(repository: string, ref: string = 'main'): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repository}/${ref}/manifest.json`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Tarball URL resolution ─────────────────────────────────────────

const ARCH_TOKENS: Record<string, string[]> = {
  arm64: ['arm64', 'aarch64'],
  x64: ['amd64', 'x64', 'x86_64'],
};

function archMatches(assetName: string, arch: string): boolean {
  const tokens = ARCH_TOKENS[arch] ?? [];
  return tokens.some((t) => new RegExp(`(?:^|[-_.])${t}(?:[-_.]|\\.tar\\.gz$)`, 'i').test(assetName));
}

function hasAnyArchToken(assetName: string): boolean {
  return Object.values(ARCH_TOKENS).flat().some(
    (t) => new RegExp(`(?:^|[-_.])${t}(?:[-_.]|\\.tar\\.gz$)`, 'i').test(assetName),
  );
}

/** Tarball URL for the current arch, with universal + source-tarball fallbacks. */
function pickTarballUrl(rel: GitHubRelease, repository: string, arch: string = process.arch): string {
  const tarballs = (rel.assets ?? []).filter(
    (a) => /\.tar\.gz$/i.test(a.name) && !/\.sha256$/i.test(a.name),
  );
  const archAsset = tarballs.find((a) => archMatches(a.name, arch));
  if (archAsset?.browser_download_url) return archAsset.browser_download_url;
  const universal = tarballs.find((a) => !hasAnyArchToken(a.name));
  if (universal?.browser_download_url) return universal.browser_download_url;
  return `https://api.github.com/repos/${repository}/tarball/${rel.tag_name ?? 'HEAD'}`;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Re-validates the repo identifier so no caller can splice arbitrary segments into the
 *  github.com URL we build below — defence-in-depth against the schema in /install. */
export async function resolveInstallUrl(repository: string): Promise<string> {
  if (!REPO_PATTERN.test(repository)) {
    throw new Error(`Invalid repository identifier: ${repository}`);
  }
  // Rate-limit errors propagate: falling back to the source tarball would install a plugin
  // without its built `dist/`, which fails later with an opaque "Cannot find module".
  const rel = await fetchLatestRelease(repository);
  if (rel) return pickTarballUrl(rel, repository);
  return `https://api.github.com/repos/${repository}/tarball/HEAD`;
}

// ── Update check pipeline ──────────────────────────────────────────

/** De-dups concurrent calls via a shared in-flight promise so two admins (or a tab refresh
 *  + background poll) don't each fire N GitHub calls and burn the unauthenticated 60 req/h
 *  limit. `force: true` (admin Reload button) bypasses the in-flight + release caches. */
export async function checkUpdatesForRegistryPlugins(
  plugins: { id: string; repository: string; version: string }[],
  opts: { force?: boolean } = {},
): Promise<UpdateCheckBatch> {
  if (opts.force) return runUpdateCheck(plugins, true);
  if (inflightUpdateCheck) return inflightUpdateCheck;
  inflightUpdateCheck = runUpdateCheck(plugins, false).finally(() => { inflightUpdateCheck = null; });
  return inflightUpdateCheck;
}

async function runUpdateCheck(
  plugins: { id: string; repository: string; version: string }[],
  force: boolean,
): Promise<UpdateCheckBatch> {
  const results = new Map<string, UpdateCheckResult>();
  let anySuccess = false;
  for (const p of plugins) {
    try {
      const rel = await fetchLatestRelease(p.repository, force);
      const latest = rel?.tag_name ? rel.tag_name.replace(/^v/i, '') : null;
      results.set(p.id, {
        installed: p.version,
        latest,
        available: isUpdateAvailable(p.version, latest),
        repository: p.repository,
      });
      anySuccess = true;
    } catch {
      results.set(p.id, { installed: p.version, latest: null, available: false, repository: p.repository });
    }
  }
  return { ok: plugins.length === 0 || anySuccess, results };
}

/** Sort GitHub release tags by descending semver. The actual update-available check uses
 *  the `semver` package — this is just for ranking lists. */
function compareTagDesc(a: string, b: string): number {
  const parse = (t: string) => {
    const [core, ...pre] = t.replace(/^v/i, '').split('-');
    const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return { parts, pre: pre.join('-') };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    if (A.parts[i] !== B.parts[i]) return B.parts[i] - A.parts[i];
  }
  if (!A.pre && B.pre) return -1;
  if (A.pre && !B.pre) return 1;
  return B.pre.localeCompare(A.pre);
}
