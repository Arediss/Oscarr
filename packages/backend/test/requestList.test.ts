import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { requestListRoutes } from '../src/routes/requests/list.js';

const app = Fastify();
let userId: number;
let otherUserId: number;
let ownerScoped = false;
beforeAll(async () => {
  app.addHook('preHandler', async request => {
    request.user = { id: userId, role: 'user' } as typeof request.user;
    request.ownerScoped = ownerScoped;
  });
  await app.register(requestListRoutes, { prefix: '/requests' });
  await app.ready();
});
afterAll(() => app.close());
beforeEach(async () => {
  ownerScoped = false;
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.user.deleteMany();
  userId = (await prisma.user.create({ data: { email: 'first@test.local' } })).id;
  otherUserId = (await prisma.user.create({ data: { email: 'second@test.local' } })).id;
});

async function addSeries(tmdbId: number, seasons: number, requester = userId) {
  const media = await prisma.media.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType: 'tv' } }, update: {},
    create: { tmdbId, mediaType: 'tv', title: `Series ${tmdbId}` },
  });
  for (let season = 1; season <= seasons; season++) await prisma.mediaRequest.create({
    data: { mediaId: media.id, userId: requester, mediaType: 'tv', seasons: JSON.stringify([season]), status: season === 1 ? 'pending' : 'approved' },
  });
}

describe('complete request groups', () => {
  it('keeps every season together across pages and preserves the legacy row pagination', async () => {
    await addSeries(1, 25);
    for (let id = 2; id <= 22; id++) await addSeries(id, 1);
    const first = (await app.inject('/requests?groupBy=mediaUser')).json();
    const second = (await app.inject('/requests?groupBy=mediaUser&page=2')).json();
    expect(first.total).toBe(22);
    expect(first.totalPages).toBe(2);
    expect(first.results).toHaveLength(20);
    expect(second.results).toHaveLength(26);
    expect(second.results.filter((r: { media: { tmdbId: number } }) => r.media.tmdbId === 1)).toHaveLength(25);
    expect((await app.inject('/requests?groupBy=mediaUser&page=3')).json().results).toEqual([]);
    const legacy = (await app.inject('/requests')).json();
    expect(legacy.total).toBe(46);
    expect(legacy.results).toHaveLength(20);
  });

  it('applies owner access and filters to both group selection and rows', async () => {
    await addSeries(1, 3);
    await addSeries(1, 2, otherUserId);
    expect((await app.inject('/requests?groupBy=mediaUser')).json().total).toBe(2);
    ownerScoped = true;
    const result = (await app.inject(`/requests?groupBy=mediaUser&status=approved&userId=${otherUserId}`)).json();
    expect(result.total).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r: { userId: number; status: string }) => r.userId === userId && r.status === 'approved')).toBe(true);
  });
});
