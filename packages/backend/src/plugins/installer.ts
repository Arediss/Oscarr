import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { lookup as dnsLookup } from 'node:dns/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract as tarExtract } from 'tar';
import { Agent, fetch as undiciFetch } from 'undici';
import { parseManifest } from './manifestSchema.js';
import { getPluginsDir } from './loader.js';
import type { PluginManifest } from './types.js';
import { isPrivateIPv4, isPrivateIPv6, isPrivateAddress, normalizeHost } from '../utils/ssrfGuard.js';
import { withRetry } from '../utils/fetchWithRetry.js';

const DOWNLOAD_TIMEOUT_MS = 60_000;
// Hard cap on plugin tarballs. Oscarr plugins are small (a few hundred KB once bundled); 50 MB
// is generous and still keeps a misconfigured / malicious registry entry from filling /tmp.
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Resolve the hostname once ourselves, pick a public address, and pin undici's connection to it.
 *
 * The previous implementation did a CIDR check with dns.lookup, then let fetch resolve again
 * when opening the socket. An attacker-controlled DNS zone can return public IPs on the first
 * lookup and a private IP on the second — a classic DNS-rebind SSRF bypass. By passing an Agent
 * with a custom connect.lookup we guarantee the socket connects to the address we validated.
 *
 * Plugin install is ALWAYS guarded (not opt-in via OSCARR_BLOCK_PRIVATE_SERVICES) because the
 * URL comes from an admin-typed registry entry and can legitimately only be a public GitHub
 * tarball — no reason to allow a LAN target here.
 */
async function buildPinnedAgent(rawHostname: string): Promise<{ agent: Agent; pinned: string }> {
  const { host, mappedIPv4 } = normalizeHost(rawHostname);
  if (mappedIPv4) {
    if (isPrivateIPv4(mappedIPv4)) {
      throw new Error(`Refusing to download from IPv4-mapped IPv6 ${host} → ${mappedIPv4} (private)`);
    }
    return { agent: makeAgent(mappedIPv4, 4), pinned: mappedIPv4 };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIPv4(host)) throw new Error(`Refusing to download from private IPv4 ${host}`);
    return { agent: makeAgent(host, 4), pinned: host };
  }
  if (host.includes(':')) {
    if (isPrivateIPv6(host)) throw new Error(`Refusing to download from private IPv6 ${host}`);
    return { agent: makeAgent(host, 6), pinned: host };
  }
  const addresses = await dnsLookup(host, { all: true })
    .catch(() => [] as Array<{ address: string; family: number }>);
  if (addresses.length === 0) throw new Error(`DNS lookup failed for ${host}`);
  // Reject if ANY resolved address is private — some hosts round-robin internal IPs and we want
  // to fail closed rather than depend on luck-of-the-draw which public IP we'd pick.
  for (const { address, family } of addresses) {
    if (isPrivateAddress(address, family)) {
      throw new Error(`Refusing to download from ${host} → ${address} (private network)`);
    }
  }
  const pick = addresses[0];
  return { agent: makeAgent(pick.address, pick.family), pinned: pick.address };
}

function makeAgent(pinnedIp: string, family: number): Agent {
  return new Agent({
    connect: {
      lookup: (_host, opts, cb) => {
        // Node ≥20's net.lookupAndConnectMultiple calls with { all: true } and expects an array;
        // older callers use the (err, address, family) shape. Support both.
        const all = (opts as { all?: boolean })?.all;
        if (all) (cb as unknown as (err: NodeJS.ErrnoException | null, addrs: Array<{ address: string; family: number }>) => void)(null, [{ address: pinnedIp, family }]);
        else cb(null, pinnedIp, family);
      },
    },
  });
}

const MAX_REDIRECTS = 5;

async function downloadToFile(url: string, destPath: string): Promise<void> {
  // Manual redirect handling: each hop gets a freshly pinned agent for its hostname. With
  // `redirect: 'follow'` undici reuses the *initial* pinned IP across redirects, so a hop to a
  // different host (github.com → codeload.github.com) hits the wrong server and 400s.
  let currentUrl = url;
  let res: Awaited<ReturnType<typeof undiciFetch>> | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    const { agent } = await buildPinnedAgent(parsed.hostname);
    // Retry the hop on transient failures before giving up — a brief 503 from GitHub /
    // codeload shouldn't abort a plugin install. undici's fetch resolves on 5xx (doesn't
    // throw), so we translate 5xx into a thrown error so withRetry's retryability check
    // catches it; network errors (ECONNRESET, etc.) throw natively.
    const hopRes = await withRetry(async () => {
      const r = await undiciFetch(currentUrl, {
        dispatcher: agent,
        redirect: 'manual',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (r.status >= 500 && r.status < 600) {
        throw Object.assign(new Error(`Upstream ${r.status}`), { response: { status: r.status } });
      }
      return r;
    }, { label: 'PluginDownload' });
    if (hopRes.status >= 300 && hopRes.status < 400) {
      const location = hopRes.headers.get('location');
      if (!location) throw new Error(`Redirect ${hopRes.status} without Location header`);
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    res = hopRes;
    break;
  }
  if (!res) throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${res.statusText}`);
  if (!res.body) throw new Error('Download returned empty body');

  // Content-length early-reject — best-effort, some servers omit it. We still enforce the
  // byte counter below.
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Plugin archive too large: ${declared} bytes (max ${MAX_DOWNLOAD_BYTES})`);
  }

  let received = 0;
  const sizeGate = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) {
        return cb(new Error(`Plugin archive exceeds ${MAX_DOWNLOAD_BYTES} bytes — aborted mid-download`));
      }
      cb(null, chunk);
    },
  });

  const nodeStream = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  const fileStream = createWriteStream(destPath);
  await pipeline(nodeStream, sizeGate, fileStream);
}

// Manifest may live either at the archive root or inside a single top-level directory
// (common for GitHub auto-generated source tarballs named `<repo>-<sha>/`). Refuse if multiple
// candidates exist — a legit plugin archive contains exactly one manifest, anything else is
// either bogus or a deliberate attempt to hide a second plugin inside the tarball.
async function findManifestRoot(extractedDir: string): Promise<string> {
  if (existsSync(join(extractedDir, 'manifest.json'))) return extractedDir;
  const entries = await readdir(extractedDir, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(extractedDir, entry.name, 'manifest.json'))) candidates.push(entry.name);
  }
  if (candidates.length === 0) {
    throw new Error('No manifest.json found in the downloaded archive (looked at root + one level down)');
  }
  if (candidates.length > 1) {
    throw new Error(`Archive contains multiple manifest.json files (${candidates.join(', ')}) — plugin archives must have exactly one`);
  }
  return join(extractedDir, candidates[0]);
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  dir: string;
}

/**
 * Download + extract + validate + move a plugin tarball into the plugins directory.
 * Returns the installed dir so the engine can load the plugin in place.
 *
 * Supported archive formats: tar.gz / tgz (any archive that `tar` can consume).
 *
 * Does NOT load the plugin — the engine's loadSingle() picks up from the final dir.
 * On any failure, the working tmp dir is cleaned up.
 */
export async function installPluginFromUrl(url: string): Promise<InstalledPlugin> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Only http(s) URLs are supported');
  }
  // Stage inside the plugins dir (under a hidden name the loader ignores) so the final rename
  // stays on the same filesystem — `os.tmpdir()` is often a separate tmpfs mount in containers,
  // which makes fs.rename() throw EXDEV (cross-device link not permitted).
  const workDir = join(getPluginsDir(), `.oscarr-plugin-install-${randomUUID()}`);
  const downloadPath = join(workDir, 'download.tar.gz');
  const extractDir = join(workDir, 'extracted');

  try {
    await mkdir(extractDir, { recursive: true });
    await downloadToFile(url, downloadPath);
    await tarExtract({
      file: downloadPath,
      cwd: extractDir,
      // Reject anything that isn't a plain file or directory — symlink entries would survive the
      // move to plugins/<id>/ and, once the ESM loader follows them, could dynamic-import JS from
      // anywhere readable on disk (arbitrary code execution). Also refuse absolute paths and
      // `..` segments so a crafted archive can't write outside the extraction root.
      filter: (path, entry) => {
        // tar@7 types the filter as Stats | ReadEntry; for extract we only ever see ReadEntry,
        // and Stats happens to expose the same membership test for our shape guard.
        const type = 'type' in entry ? entry.type : null;
        if (type !== 'File' && type !== 'Directory') return false;
        if (path.startsWith('/') || path.split('/').includes('..')) return false;
        return true;
      },
    });

    const manifestRoot = await findManifestRoot(extractDir);
    const raw = await readFile(join(manifestRoot, 'manifest.json'), 'utf-8');
    const data = JSON.parse(raw);
    const manifest = parseManifest(data, manifestRoot) as PluginManifest;

    // Refuse an archive whose declared entry point isn't in it. Catches the classic case of a
    // GitHub source tarball being installed instead of a release asset: plugins gitignore their
    // built `dist/`, so the install "succeeds" and only fails at import time with an opaque
    // "Cannot find module". Better to reject here with something the admin can act on.
    if (!existsSync(join(manifestRoot, manifest.entry))) {
      throw new Error(
        `Archive is missing its entry point "${manifest.entry}". This usually means a source `
        + 'archive was downloaded instead of a built release asset — check that the plugin\'s '
        + 'latest GitHub release has a .tar.gz asset attached.',
      );
    }

    const targetDir = join(getPluginsDir(), manifest.id);
    if (existsSync(targetDir)) {
      throw new Error(
        `Plugin "${manifest.id}" already installed at ${targetDir}. Uninstall it first.`
      );
    }

    await rename(manifestRoot, targetDir);
    return { manifest, dir: targetDir };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
}
