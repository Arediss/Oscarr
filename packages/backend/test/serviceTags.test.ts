import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { servicesHelperRoutes } from '../src/routes/admin/services/helpers.js';
import { createServiceTagClient, getServiceSchemas } from '../src/providers/index.js';

const transport = vi.hoisted(() => ({ apply: vi.fn(async () => undefined) }));
// A tag-capable provider needs no ArrClient, TV/movie mapping or provider-name exception.
vi.mock('../src/providers/sonarr/index.js', () => ({
  sonarrProvider: { service: {
    id: 'readarr', label: 'Readarr', icon: '/readarr.svg', category: 'arr', fields: [],
    handlesMediaTypes: ['book'], test: async () => ({ ok: true }),
    createTagClient: (config: Record<string, string>) => ({
      getTags: async () => [{ id: 7, label: config.url === 'http://one' ? 'VOSTFR' : 'VF' }],
      addTagsToMedia: (id: number, tags: number[]) => transport.apply(config.url, id, tags),
    }),
  } },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.folderRule.deleteMany();
  await prisma.service.deleteMany();
});

describe('service tag contract', () => {
  it('advertises tag support separately from media routing', () => {
    expect(getServiceSchemas().find(service => service.id === 'readarr')).toMatchObject({
      supportsTags: true, supportsRouting: false, handlesMediaTypes: ['book'],
    });
    expect(getServiceSchemas().find(service => service.id === 'plex')).toMatchObject({ supportsTags: false });
  });

  it('lists identical tag IDs on separate instances through the registered capability', async () => {
    const one = await prisma.service.create({ data: { name: 'Books', type: 'readarr', config: '{"url":"http://one"}' } });
    const two = await prisma.service.create({ data: { name: 'Books', type: 'readarr', config: '{"url":"http://two"}' } });
    const app = Fastify();
    await app.register(servicesHelperRoutes);
    try {
      const first = await app.inject(`/services/${one.id}/tags`);
      const second = await app.inject(`/services/${two.id}/tags`);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual([{ id: 7, label: 'VOSTFR' }]);
      expect(second.json()).toEqual([{ id: 7, label: 'VF' }]);
      await prisma.service.update({ where: { id: two.id }, data: { enabled: false } });
      expect((await app.inject(`/services/${two.id}/tags`)).statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it('applies tags through the same instance-bound contract', async () => {
    const client = createServiceTagClient('readarr', { url: 'http://two' });
    await client.addTagsToMedia(42, [7]);
    expect(transport.apply).toHaveBeenCalledWith('http://two', 42, [7]);
    expect(() => createServiceTagClient('plex', {})).toThrow('SERVICE_TAGS_UNSUPPORTED');
  });
});
