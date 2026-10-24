import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { patchAppSettings } from '../src/utils/appSettings.js';
import { createUserRequest, requestCollectionMovie } from '../src/services/requestService.js';
import { pluginEngine } from '../src/plugins/engine.js';
import { safeUserNotify } from '../src/utils/safeNotify.js';

const transport = vi.hoisted(() => ({
  getRootFolders: vi.fn(async () => [{ path: '/movies' }]),
  defaultRootFolder: '/movies',
  findByExternalId: vi.fn(async () => ({ id: 42 })),
  searchMedia: vi.fn(async () => undefined),
  requestSeasons: vi.fn(async () => undefined),
}));

vi.mock('../src/providers/index.js', async (original) => ({
  ...await original<typeof import('../src/providers/index.js')>(),
  getArrClient: vi.fn(async () => transport),
  getArrClientForService: vi.fn(() => transport),
}));
vi.mock('../src/plugins/engine.js', () => ({ pluginEngine: { runGuards: vi.fn() } }));
vi.mock('../src/utils/logEvent.js', () => ({ logEvent: vi.fn() }));
vi.mock('../src/utils/safeNotify.js', () => ({
  safeNotify: vi.fn(), safeUserNotify: vi.fn(), buildSiteLink: vi.fn(async () => undefined),
}));
vi.mock('../src/services/tmdb.js', async (original) => ({
  ...await original<typeof import('../src/services/tmdb.js')>(),
  getMovieDetails: vi.fn(async () => ({ id: 101, title: 'Test movie', genres: [], original_language: 'en' })),
}));

let userId: number;
let adminId: number;
const ADMIN_ROLE = 'admin';
const INITIAL_MEDIA_CATEGORY = 'UNAVAILABLE';
const request = (extra: Partial<Parameters<typeof createUserRequest>[0]> = {}) =>
  createUserRequest({ userId, tmdbId: 101, mediaType: 'movie', ...extra });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(pluginEngine.runGuards).mockResolvedValue({ blocked: false });
  transport.searchMedia.mockResolvedValue(undefined);
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.user.deleteMany();
  await prisma.folderRule.deleteMany();
  await prisma.qualityOption.deleteMany();
  await prisma.service.deleteMany();
  await prisma.requestCriterion.deleteMany();
  await patchAppSettings({ requestsEnabled: true, autoApproveRequests: false, defaultQualityProfile: 1 });
  userId = (await prisma.user.create({ data: { email: 'requester@test.local', displayName: 'Requester' } })).id;
  adminId = (await prisma.user.create({ data: { email: 'admin@test.local', role: ADMIN_ROLE } })).id;
  await prisma.media.create({ data: { tmdbId: 101, mediaType: 'movie', title: 'Test movie' } });
});

describe('request access gates', () => {
  it('disables requests for administrators and plugin callers too', async () => {
    await patchAppSettings({ requestsEnabled: false });
    expect(await request({ userId: adminId, skipPluginGuard: true })).toMatchObject({ code: 'REQUESTS_DISABLED' });
    expect(await prisma.mediaRequest.count()).toBe(0);
    expect(pluginEngine.runGuards).not.toHaveBeenCalled();
  });

  it('preserves a plugin refusal before creating any request', async () => {
    vi.mocked(pluginEngine.runGuards).mockResolvedValue({ blocked: true, error: 'Quota exceeded' });
    expect(await request()).toMatchObject({ status: 403, code: 'BLOCKED_BY_GUARD', error: 'Quota exceeded' });
    expect(await prisma.mediaRequest.count()).toBe(0);
  });

  it('lets a plugin explicitly bypass other plugin guards', async () => {
    expect(await request({ skipPluginGuard: true })).toMatchObject({ ok: true, status: 201 });
    expect(pluginEngine.runGuards).not.toHaveBeenCalled();
  });

  it('keeps quality role restrictions even when automatic approval is enabled', async () => {
    const quality = await prisma.qualityOption.create({ data: { label: '4K', allowedRoles: '["admin"]', approvalMode: 'auto' } });
    expect(await request({ qualityOptionId: quality.id })).toMatchObject({ code: 'QUALITY_NOT_ALLOWED' });
    expect(await prisma.mediaRequest.count()).toBe(0);
  });
});

describe('request approval and dispatch', () => {
  it('notifies administrators for pending requests without dispatching', async () => {
    expect(await request()).toMatchObject({ ok: true, request: { status: 'pending' } });
    expect(safeUserNotify).toHaveBeenCalledWith(adminId, expect.objectContaining({ type: 'request_pending_review' }));
    expect(transport.searchMedia).not.toHaveBeenCalled();
  });

  it.each([
    ['auto', false, 'user', 'approved'],
    ['manual', true, 'user', 'pending'],
    ['manual', false, ADMIN_ROLE, 'approved'],
  ])('applies quality approval %s with default %s for %s', async (mode, defaultApproval, role, status) => {
    await patchAppSettings({ autoApproveRequests: defaultApproval });
    const quality = await prisma.qualityOption.create({ data: { label: 'HD', approvalMode: mode } });
    expect(await request({ userId: role === ADMIN_ROLE ? adminId : userId, qualityOptionId: quality.id }))
      .toMatchObject({ ok: true, request: { status } });
  });

  it.each([INITIAL_MEDIA_CATEGORY, 'AVAILABLE', 'PROCESSING'])('preserves the media state after dispatch from %s', async (category) => {
    await patchAppSettings({ autoApproveRequests: true });
    await prisma.media.updateMany({ data: { statusCategory: category } });
    expect(await request()).toMatchObject({ ok: true, status: 201 });
    expect(transport.searchMedia).toHaveBeenCalledWith(42);
    expect((await prisma.media.findFirst())?.statusCategory).toBe(category === INITIAL_MEDIA_CATEGORY ? 'SEARCHING' : category);
    expect(safeUserNotify).not.toHaveBeenCalled();
  });

  it('returns 202 and persists a failed request when the service rejects dispatch', async () => {
    await patchAppSettings({ autoApproveRequests: true });
    transport.searchMedia.mockRejectedValueOnce(new Error('Service unavailable'));
    expect(await request()).toMatchObject({ ok: true, status: 202, sendFailed: true });
    expect((await prisma.mediaRequest.findFirst())?.status).toBe('failed');
    expect((await prisma.media.findFirst())?.statusCategory).toBe(INITIAL_MEDIA_CATEGORY);
  });
});

describe('collection request approval', () => {
  it.each([
    [true, 'proche', 'approved'],
    [false, 'proche', 'pending'],
    [false, ADMIN_ROLE, 'approved'],
  ])('uses global approval %s for %s', async (autoApproveRequests, role, status) => {
    await patchAppSettings({ autoApproveRequests });
    await prisma.user.update({ where: { id: userId }, data: { role } });
    expect(await requestCollectionMovie(101, { id: userId, role })).toBe(true);
    expect(await prisma.mediaRequest.findFirst()).toMatchObject({
      status, approvedById: status === 'approved' ? userId : null,
    });
    expect(transport.searchMedia).toHaveBeenCalledTimes(status === 'approved' ? 1 : 0);
  });

  it('keeps auto-approved collection requests retryable when dispatch fails', async () => {
    await patchAppSettings({ autoApproveRequests: true });
    transport.searchMedia.mockRejectedValueOnce(new Error('Service unavailable'));
    expect(await requestCollectionMovie(101, { id: userId, role: 'user' })).toBe(true);
    expect(await prisma.mediaRequest.findFirst()).toMatchObject({ status: 'failed' });
  });

  it('skips existing collection requests', async () => {
    await patchAppSettings({ autoApproveRequests: true });
    await requestCollectionMovie(101, { id: userId, role: 'user' });
    expect(await requestCollectionMovie(101, { id: userId, role: 'user' })).toBe(false);
    expect(await prisma.mediaRequest.count()).toBe(1);
    expect(transport.searchMedia).toHaveBeenCalledTimes(1);
  });
});

describe('request criteria and duplicate detection', () => {
  async function languageValues() {
    const criterion = await prisma.requestCriterion.create({
      data: { name: 'Language', values: { create: [{ label: 'French' }, { label: 'English' }] } },
      include: { values: true },
    });
    return criterion.values.map(value => value.id);
  }

  it('rejects unknown values before persisting the request', async () => {
    expect(await request({ criterionValueIds: [2147483647] })).toMatchObject({ code: 'UNKNOWN_CRITERION_VALUE' });
    expect(await prisma.mediaRequest.count()).toBe(0);
  });

  it('rejects two values from the same criterion', async () => {
    expect(await request({ criterionValueIds: await languageValues() })).toMatchObject({ code: 'CRITERION_CONFLICT' });
    expect(await prisma.mediaRequest.count()).toBe(0);
  });

  it('deduplicates repeated IDs but allows a different criterion choice', async () => {
    const [french, english] = await languageValues();
    expect(await request({ criterionValueIds: [french, french] })).toMatchObject({ ok: true });
    expect(await request({ criterionValueIds: [french] })).toMatchObject({ code: 'DUPLICATE' });
    expect(await request({ criterionValueIds: [english] })).toMatchObject({ ok: true });
    expect(await prisma.mediaRequest.count()).toBe(2);
    expect(await prisma.mediaRequestCriterion.count()).toBe(2);
  });
});

describe('season requests', () => {
  beforeEach(async () => {
    await prisma.media.create({ data: { tmdbId: 202, tvdbId: 303, mediaType: 'tv', title: 'Test series' } });
  });
  const seasonRequest = (seasons?: number[]) => request({ tmdbId: 202, mediaType: 'tv', seasons });

  it('allows distinct seasons but rejects overlapping requests', async () => {
    expect(await seasonRequest([1])).toMatchObject({ ok: true });
    expect(await seasonRequest([2])).toMatchObject({ ok: true });
    expect(await seasonRequest([2, 3])).toMatchObject({ code: 'DUPLICATE' });
    expect(await seasonRequest()).toMatchObject({ code: 'DUPLICATE' });
  });
  it('treats an existing whole-series request as covering every season', async () => {
    expect(await seasonRequest()).toMatchObject({ ok: true });
    expect(await seasonRequest([2])).toMatchObject({ code: 'DUPLICATE' });
  });
  it('dispatches only the selected season of an existing series', async () => {
    await patchAppSettings({ autoApproveRequests: true });
    expect(await seasonRequest([2])).toMatchObject({ ok: true });
    expect(transport.requestSeasons).toHaveBeenCalledWith(42, [2]);
    expect(transport.searchMedia).not.toHaveBeenCalled();
  });
  it.each([[0], [-1], [1.5]])('rejects invalid season numbers %j', async (...seasons) => {
    expect(await seasonRequest(seasons)).toMatchObject({ ok: false, status: 400 });
    expect(await prisma.mediaRequest.count()).toBe(0);
  });
});

describe('equivalent quality requests', () => {
  async function configure(profile = 1) {
    const service = await prisma.service.create({ data: { name: 'Radarr test', type: 'radarr', config: '{}' } });
    const quality = await prisma.qualityOption.create({ data: { label: 'HD' } });
    await prisma.qualityMapping.create({ data: { qualityProfileName: 'Test profile', qualityOptionId: quality.id, serviceId: service.id, qualityProfileId: profile } });
    return quality.id;
  }
  it.each([true, false])('deduplicates default and HD in either order (default first: %s)', async defaultFirst => {
    const qualityOptionId = await configure();
    expect(await request(defaultFirst ? {} : { qualityOptionId })).toMatchObject({ ok: true });
    expect(await request(defaultFirst ? { qualityOptionId } : {})).toMatchObject({ code: 'DUPLICATE' });
    expect(await prisma.mediaRequest.count()).toBe(1);
  });
  it('still allows a genuinely different profile', async () => {
    const qualityOptionId = await configure(4);
    expect(await request()).toMatchObject({ ok: true });
    expect(await request({ qualityOptionId })).toMatchObject({ ok: true });
  });
});
