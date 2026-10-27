import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { folderRulesRoutes } from '../src/routes/admin/folderRules.js';
import { servicesHelperRoutes } from '../src/routes/admin/services/helpers.js';
import { matchFolderRule } from '../src/services/folderRules.js';
import type { TmdbTv } from '../src/services/tmdb.js';

const transport = vi.hoisted(() => ({ getTags: vi.fn() }));
vi.mock('../src/providers/index.js', async (original) => ({
  ...await original<typeof import('../src/providers/index.js')>(),
  createArrClient: vi.fn(() => transport),
}));

let serviceId: number;
const conditions = [{ field: 'genre', operator: 'contains', value: 'Animation' }];
const anime = { id: 1, genres: [{ id: 16, name: 'Animation' }] } as TmdbTv;
const payload = () => ({ name: 'Anime VOSTFR', mediaType: 'tv', conditions, folderPath: '/anime', serviceId, tagIds: [7, 9] });

beforeEach(async () => {
  vi.clearAllMocks();
  transport.getTags.mockResolvedValue([{ id: 7, label: 'vostfr' }, { id: 9, label: 'anime' }]);
  await prisma.folderRule.deleteMany();
  await prisma.service.deleteMany();
  serviceId = (await prisma.service.create({ data: { name: 'Sonarr', type: 'sonarr', config: '{}' } })).id;
});

async function withApi(run: (app: ReturnType<typeof Fastify>) => Promise<void>) {
  const app = Fastify();
  await app.register(folderRulesRoutes);
  await app.register(servicesHelperRoutes);
  try { await run(app); } finally { await app.close(); }
}

describe('routing tag actions', () => {
  it('persists, reads, matches, duplicates, preserves on partial edits and clears tags', () => withApi(async app => {
    const created = await app.inject({ method: 'POST', url: '/folder-rules', payload: payload() });
    expect(created.statusCode).toBe(201);
    const rule = created.json();
    expect(rule.tagIds).toEqual([7, 9]);
    expect((await matchFolderRule('tv', anime))?.tagIds).toEqual([7, 9]);
    const renamed = await app.inject({ method: 'PUT', url: `/folder-rules/${rule.id}`, payload: { name: 'Renamed' } });
    expect(renamed.json().tagIds).toEqual([7, 9]);
    const copy = await app.inject({ method: 'POST', url: `/folder-rules/${rule.id}/duplicate` });
    expect(copy.json()).toMatchObject({ tagIds: [7, 9], enabled: false });
    expect((await app.inject('/folder-rules')).json()[0].tagIds).toEqual([7, 9]);
    const cleared = await app.inject({ method: 'PUT', url: `/folder-rules/${rule.id}`, payload: { tagIds: [] } });
    expect(cleared.json().tagIds).toEqual([]);
  }));

  it('supports tag-only actions and legacy rules with null optional fields', () => withApi(async app => {
    const tagsOnly = await app.inject({ method: 'POST', url: '/folder-rules', payload: { ...payload(), folderPath: '', seriesType: null } });
    expect(tagsOnly.statusCode).toBe(201);
    const legacy = await app.inject({ method: 'POST', url: '/folder-rules', payload: { ...payload(), tagIds: undefined, serviceId: null, seriesType: null } });
    expect(legacy.statusCode).toBe(201);
    expect(legacy.json().tagIds).toEqual([]);
  }));

  it('rejects unknown tags, unbound tags and wrong media types', () => withApi(async app => {
    for (const extra of [{ tagIds: [999] }, { serviceId: null }, { mediaType: 'movie' }, { mediaType: 'any' }, { tagIds: [-1] }]) {
      const res = await app.inject({ method: 'POST', url: '/folder-rules', payload: { ...payload(), ...extra } });
      expect(res.statusCode).toBe(400);
    }
    expect(await prisma.folderRule.count()).toBe(0);
  }));

  it('revalidates tags on instance change and keeps the previous rule on failure', () => withApi(async app => {
    const created = (await app.inject({ method: 'POST', url: '/folder-rules', payload: payload() })).json();
    const other = await prisma.service.create({ data: { name: 'Sonarr 2', type: 'sonarr', config: '{}' } });
    transport.getTags.mockResolvedValue([{ id: 42, label: 'vostfr' }]);
    const res = await app.inject({ method: 'PUT', url: `/folder-rules/${created.id}`, payload: { serviceId: other.id } });
    expect(res.statusCode).toBe(400);
    expect((await prisma.folderRule.findUnique({ where: { id: created.id } }))?.serviceId).toBe(serviceId);
  }));

  it('requires explicit tags when another instance reuses the same numeric IDs', () => withApi(async app => {
    const created = (await app.inject({ method: 'POST', url: '/folder-rules', payload: payload() })).json();
    const other = await prisma.service.create({ data: { name: 'Sonarr 2', type: 'sonarr', config: '{}' } });
    transport.getTags.mockResolvedValue([{ id: 7, label: 'kids' }, { id: 9, label: 'french' }]);
    const res = await app.inject({ method: 'PUT', url: `/folder-rules/${created.id}`, payload: { serviceId: other.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('RULE_TAGS_RESELECT');
    const cleared = await app.inject({ method: 'PUT', url: `/folder-rules/${created.id}`, payload: { serviceId: other.id, tagIds: [] } });
    expect(cleared.json()).toMatchObject({ serviceId: other.id, tagIds: [] });
  }));

  it('skips a tag rule after its instance is deleted instead of leaking IDs to the default', () => withApi(async app => {
    await app.inject({ method: 'POST', url: '/folder-rules', payload: payload() });
    await prisma.service.delete({ where: { id: serviceId } });
    expect(await matchFolderRule('tv', anime)).toBeNull();
    expect((await app.inject('/folder-rules')).json()[0].serviceStatus).toBe('missing');
  }));

  it.each(['sonarr', 'radarr'])('fetches %s tags and reports connection failures', type => withApi(async app => {
    await prisma.service.update({ where: { id: serviceId }, data: { type } });
    const res = await app.inject(`/services/${serviceId}/tags`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 7, label: 'vostfr' }, { id: 9, label: 'anime' }]);
    transport.getTags.mockRejectedValue(new Error('offline'));
    expect((await app.inject(`/services/${serviceId}/tags`)).statusCode).toBe(502);
    expect((await app.inject('/services/999999/tags')).statusCode).toBe(404);
  }));
});
