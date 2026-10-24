import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getSeason = vi.hoisted(() => vi.fn());
vi.mock('../src/services/tmdb.js', () => ({
  getTvSeasonDetails: getSeason, getMovieDetails: vi.fn(), getTvDetails: vi.fn(),
  getPersonDetails: vi.fn(), getCollection: vi.fn(), isMatureRating: vi.fn(),
}));
vi.mock('../src/services/sync/keywordSync.js', () => ({ trackKeywordsFromDetails: vi.fn() }));
const { detailsRoutes } = await import('../src/routes/tmdb/details.js');
const app = Fastify();
await app.register(detailsRoutes, { prefix: '/api/tmdb' });
afterAll(() => app.close());
beforeEach(() => getSeason.mockReset());

describe('TMDB season details', () => {
  it('loads episodes in the requested language without a library entry', async () => {
    const data = { episodes: [{ episode_number: 1, name: 'Le départ', air_date: '2026-10-01' }] };
    getSeason.mockResolvedValue(data);
    const response = await app.inject({ url: '/api/tmdb/tv/1411/season/5', headers: { 'accept-language': 'fr-FR,fr;q=0.9' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(data);
    expect(getSeason).toHaveBeenCalledWith(1411, 5, 'fr');
  });
  it.each(['/tv/0/season/1', '/tv/12x/season/1', '/tv/1/season/-1', '/tv/1/season/1.5', '/tv/1/season/nope'])(
    'rejects invalid resource numbers before calling TMDB: %s', async path => {
      expect((await app.inject(`/api/tmdb${path}`)).statusCode).toBe(400);
      expect(getSeason).not.toHaveBeenCalled();
    },
  );
});
