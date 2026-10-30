import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { patchAppSettings } from '../src/utils/appSettings.js';
import { createUserRequest, retryFailedRequests, sendToService } from '../src/services/requestService.js';
import { logEvent } from '../src/utils/logEvent.js';

// Exercise the real provider and dispatch path. Only the upstream HTTP boundary is replaced.
const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('axios', () => ({ default: { create: ({ baseURL }: { baseURL: string }) => ({
  get: (path: string, options?: unknown) => network.get(baseURL, path, options),
  post: (path: string, body?: unknown) => network.post(baseURL, path, body),
  put: (path: string, body?: unknown) => network.put(baseURL, path, body),
}) } }));
vi.mock('../src/utils/fetchWithRetry.js', () => ({ attachAxiosRetry: (client: unknown) => client }));
vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));
vi.mock('../src/utils/safeNotify.js', () => ({
  safeNotify: vi.fn(), safeUserNotify: vi.fn(), buildSiteLink: vi.fn(async () => undefined),
}));
vi.mock('../src/plugins/engine.js', () => ({ pluginEngine: { runGuards: vi.fn(async () => ({ blocked: false })) } }));
vi.mock('../src/services/tmdb.js', async original => ({
  ...await original<typeof import('../src/services/tmdb.js')>(),
  getTvDetails: vi.fn(async () => ({
    id: 299255, name: 'Surveillant !', external_ids: { tvdb_id: null }, genres: [{ id: 18, name: 'Drama' }],
    seasons: [{ season_number: 1, episode_count: 8 }], original_language: 'en',
  })),
}));

const tmdbId = 299255;
const tvdbId = 476017;
const targetUrl = 'http://sonarr-target.test/api/v3';
const ignoredUrl = 'http://sonarr-default.test/api/v3';
const lookupResult = () => ({
  id: 0, tmdbId, tvdbId, imdbId: 'tt44924447', title: 'Minimum Security', titleSlug: 'minimum-security',
  overview: 'A series found by Sonarr despite an absent TMDB external ID.', year: 2026,
  firstAired: '2026-01-01T00:00:00Z', runtime: 30, status: 'continuing', monitored: false,
  seasons: [{ seasonNumber: 1, monitored: false }], images: [], tags: [], genres: [],
});

let targetId: number;
let requesterId: number;
let lookupData: unknown;
let lookupError: Error | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  lookupData = [lookupResult()];
  lookupError = undefined;
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.folderRule.deleteMany();
  await prisma.qualityOption.deleteMany();
  await prisma.service.deleteMany();
  await prisma.user.deleteMany();
  await patchAppSettings({ requestsEnabled: true, autoApproveRequests: true,
    arrUserTaggingEnabled: false, defaultQualityProfile: 1 });
  requesterId = (await prisma.user.create({ data: { email: 'identity@test.local', displayName: 'Requester' } })).id;
  await prisma.service.create({ data: {
    name: 'Default Sonarr', type: 'sonarr', isDefault: true,
    config: JSON.stringify({ url: 'http://sonarr-default.test', apiKey: 'default-test-key' }),
  } });
  targetId = (await prisma.service.create({ data: {
    name: 'Target Sonarr', type: 'sonarr',
    config: JSON.stringify({ url: 'http://sonarr-target.test', apiKey: 'target-test-key' }),
  } })).id;
  await prisma.folderRule.create({ data: {
    name: 'TV target', mediaType: 'tv', conditions: '[{"field":"genre","operator":"contains","value":"Drama"}]',
    folderPath: '/tv', serviceId: targetId,
  } });
  network.get.mockImplementation(async (baseURL: string, path: string, options?: { params?: { term?: string } }) => {
    if (baseURL !== targetUrl) throw new Error(`Unexpected service lookup: ${baseURL}`);
    if (path === '/rootfolder') return { data: [{ id: 1, path: '/tv' }] };
    if (path === '/qualityprofile') return { data: [{ id: 1, name: 'HD' }] };
    if (path === '/series') return { data: [] };
    if (path === '/series/lookup') {
      if (lookupError) throw lookupError;
      if (![ `tmdb:${tmdbId}`, `tvdb:${tvdbId}` ].includes(options?.params?.term ?? '')) {
        throw new Error('Unexpected lookup identity');
      }
      return { data: lookupData };
    }
    throw new Error(`Unexpected Sonarr GET ${path}`);
  });
  network.post.mockImplementation(async (baseURL: string, path: string, body: object) => {
    if (baseURL !== targetUrl || path !== '/series') throw new Error('Unexpected Sonarr mutation');
    return { data: { ...body, id: 42 } };
  });
});

const createRequest = () => createUserRequest({ userId: requesterId, tmdbId, mediaType: 'tv' });
const storedMedia = () => prisma.media.findUnique({ where: { tmdbId_mediaType: { tmdbId, mediaType: 'tv' } } });
const tmdbLookupCalls = () => network.get.mock.calls.filter(([, path, options]) =>
  path === '/series/lookup' && options?.params?.term === `tmdb:${tmdbId}`);

describe('Sonarr identity resolution for requests (issue #237)', () => {
  it('adds a series found by TMDB ID on the routed Sonarr and persists its validated TVDB mapping', async () => {
    expect(await createRequest()).toMatchObject({ ok: true, status: 201, request: { status: 'approved' } });
    expect(await storedMedia()).toMatchObject({ tmdbId, tvdbId, serviceId: targetId });
    expect(tmdbLookupCalls()).toHaveLength(1);
    expect(tmdbLookupCalls()[0][0]).toBe(targetUrl);
    expect(network.post).toHaveBeenCalledWith(targetUrl, '/series', expect.objectContaining({
      tvdbId, qualityProfileId: 1, rootFolderPath: '/tv', monitored: true,
      seasons: [{ seasonNumber: 1, monitored: true }],
    }));
    expect(network.get.mock.calls.some(([baseURL]) => baseURL === ignoredUrl)).toBe(false);
  });

  it('retries through Sonarr even when the cached TMDB response still has no TVDB ID', async () => {
    // The TMDB stub intentionally keeps returning the same null mapping through both attempts.
    lookupError = new Error('Sonarr temporarily unavailable');
    expect(await createRequest()).toMatchObject({ ok: true, status: 202, sendFailed: true });
    expect(await storedMedia()).toMatchObject({ tvdbId: null });
    lookupError = undefined;
    expect(await retryFailedRequests()).toEqual({ retried: 1, succeeded: 1 });
    expect(await storedMedia()).toMatchObject({ tvdbId, serviceId: targetId });
    expect(await prisma.mediaRequest.findFirst()).toMatchObject({ status: 'approved' });
    expect(network.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no result', []],
    ['another TMDB title', [{ ...lookupResult(), tmdbId: tmdbId + 1 }]],
    ['missing TMDB identity', [{ ...lookupResult(), tmdbId: undefined }]],
    ['zero TVDB ID', [{ ...lookupResult(), tvdbId: 0 }]],
    ['negative TVDB ID', [{ ...lookupResult(), tvdbId: -1 }]],
  ])('does not add a series or persist a mapping for %s', async (_label, response) => {
    lookupData = response;
    expect(await createRequest()).toMatchObject({ ok: true, status: 202, sendFailed: true });
    expect(await storedMedia()).toMatchObject({ tvdbId: null, serviceId: null });
    expect(await prisma.mediaRequest.findFirst()).toMatchObject({ status: 'failed' });
    expect(network.post).not.toHaveBeenCalled();
    expect(network.put).not.toHaveBeenCalled();
    expect(tmdbLookupCalls()).toHaveLength(1);
  });

  it('keeps upstream lookup errors retryable and reports the unresolved identity without credentials', async () => {
    lookupError = new Error('Sonarr unavailable');
    expect(await createRequest()).toMatchObject({ ok: true, status: 202, sendFailed: true });
    expect(network.post).not.toHaveBeenCalled();
    expect(network.put).not.toHaveBeenCalled();
    expect(await storedMedia()).toMatchObject({ tvdbId: null });
    expect(tmdbLookupCalls()).toHaveLength(1);
    const importantLogs = vi.mocked(logEvent).mock.calls.filter(([level]) => level === 'warn' || level === 'error');
    expect(importantLogs.length).toBeGreaterThan(0);
    expect(JSON.stringify(importantLogs)).toContain(String(tmdbId));
    expect(JSON.stringify(importantLogs)).not.toContain('target-test-key');
  });

  it('preserves a known TVDB mapping and continues dispatch while TMDB external IDs remain empty', async () => {
    const media = await prisma.media.create({ data: { tmdbId, tvdbId, mediaType: 'tv', title: 'Minimum Security' } });
    expect(await sendToService(media, 'tv', 'Requester', requesterId)).toBe(true);
    expect(await storedMedia()).toMatchObject({ tmdbId, tvdbId, serviceId: targetId });
    expect(network.post).toHaveBeenCalledWith(targetUrl, '/series', expect.objectContaining({ tvdbId }));
    expect(network.get.mock.calls.some(([baseURL]) => baseURL === ignoredUrl)).toBe(false);
  });
});
