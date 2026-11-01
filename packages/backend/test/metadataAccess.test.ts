import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { registerSecurity } from '../src/bootstrap/security.js';
import { invalidateUserStateCache } from '../src/middleware/rbac.js';
import { mediaRoutes } from '../src/routes/media.js';

const metadata = vi.hoisted(() => ({ get: vi.fn(), catalog: vi.fn(), episodes: vi.fn() }));
vi.mock('../src/services/serviceMetadata.js', () => ({ getServiceMetadata: metadata.get }));
vi.mock('../src/services/seriesCatalog.js', () => ({
  getSeriesCatalog: metadata.catalog, getSeriesEpisodes: metadata.episodes,
  SeriesCatalogError: class extends Error {},
}));

const app = Fastify();
const token = 'a'.repeat(64);
const urls = [
  '/api/media/tv/60572/metadata?refresh=false',
  '/api/media/tv/60572/metadata?refresh=true',
  '/api/media/movie/550/metadata',
  '/api/media/tv/60572/seasons',
  `/api/media/tv/60572/seasons/18/episodes?source=${token}`,
];
beforeAll(async () => {
  // The production security hooks and nested route registration must be exercised together.
  await registerSecurity(app);
  await app.register(mediaRoutes, { prefix: '/api/media' });
  app.get('/api/undeclared-test-route', async () => ({ unsafe: true }));
  await app.ready();
});
afterAll(() => app.close());
beforeEach(async () => {
  vi.resetAllMocks();
  invalidateUserStateCache();
  await prisma.user.deleteMany();
  metadata.get.mockResolvedValue({ source: { provider: 'sonarr' }, title: 'Pokémon' });
  metadata.catalog.mockResolvedValue({ numbering: 'tvdb:official', seasons: [] });
  metadata.episodes.mockResolvedValue({ episodes: [] });
});

async function cookie(role = 'user', disabled = false) {
  const user = await prisma.user.create({ data: { email: `${role}@metadata.test`, role, disabled } });
  return { id: user.id, headers: { cookie: `token=${app.jwt.sign({ id: user.id, role })}` } };
}

describe('metadata routes through production authentication and RBAC', () => {
  it.each(['user', 'admin'])('allows an authenticated %s to read service metadata, seasons and episodes', async role => {
    const user = await cookie(role);
    for (const url of urls) {
      const response = await app.inject({ url, headers: user.headers });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    }
    expect(metadata.get).toHaveBeenCalledWith(60572, 'tv', { userId: user.id, refresh: false });
    expect(metadata.get).toHaveBeenCalledWith(60572, 'tv', { userId: user.id, refresh: true });
    expect(metadata.get).toHaveBeenCalledWith(550, 'movie', { userId: user.id, refresh: false });
    expect(metadata.catalog).toHaveBeenCalledWith(60572, false, user.id);
    expect(metadata.episodes).toHaveBeenCalledWith(60572, 18, token, user.id);
  });

  it('requires a session before calling any metadata provider', async () => {
    for (const url of urls) expect((await app.inject(url)).statusCode).toBe(401);
    expect(metadata.get).not.toHaveBeenCalled();
    expect(metadata.catalog).not.toHaveBeenCalled();
    expect(metadata.episodes).not.toHaveBeenCalled();
  });

  it('continues to reject disabled accounts before any provider call', async () => {
    const user = await cookie('user', true);
    for (const url of urls) {
      const response = await app.inject({ url, headers: user.headers });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'ACCOUNT_DISABLED' });
    }
    expect(metadata.get).not.toHaveBeenCalled();
    expect(metadata.catalog).not.toHaveBeenCalled();
    expect(metadata.episodes).not.toHaveBeenCalled();
  });

  it('keeps the default deny policy for undeclared routes', async () => {
    const user = await cookie('admin');
    const response = await app.inject({ url: '/api/undeclared-test-route', headers: user.headers });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'FORBIDDEN' });
  });
});
