import type { FastifyInstance } from 'fastify';
import { getAppSettings, patchAppSettings } from '../../utils/appSettings.js';
import { getTmdbApi } from '../../services/tmdb.js';
import { buildDiscoverParams, type DiscoverQuery } from '../../utils/tmdbDiscoverQuery.js';

// ── In-memory cache for public layout endpoint ─────────────────────────────
let homepageLayoutCache: { data: unknown; at: number } | null = null;
const LAYOUT_CACHE_TTL = 60_000; // 1 minute

export function invalidateHomepageLayoutCache(): void {
  homepageLayoutCache = null;
}

export function getDefaultLayout() {
  return [
    { id: 'hero', type: 'builtin', enabled: true, title: 'Hero', builtinKey: 'hero' },
    { id: 'recently_added', type: 'builtin', enabled: true, title: 'home.recently_added', builtinKey: 'recently_added' },
    { id: 'trending', type: 'builtin', enabled: true, title: 'home.trending_week', builtinKey: 'trending', size: 'large' },
    { id: 'popular_movies', type: 'builtin', enabled: true, title: 'home.popular_movies', builtinKey: 'popular_movies' },
    { id: 'popular_tv', type: 'builtin', enabled: true, title: 'home.popular_series', builtinKey: 'popular_tv' },
    { id: 'trending_anime', type: 'builtin', enabled: true, title: 'home.trending_anime', builtinKey: 'trending_anime' },
    { id: 'genres', type: 'builtin', enabled: true, title: 'home.genres', builtinKey: 'genres' },
    { id: 'upcoming', type: 'builtin', enabled: true, title: 'home.coming_soon', builtinKey: 'upcoming' },
  ];
}

export async function getHomepageLayout(): Promise<unknown> {
  const now = Date.now();
  if (homepageLayoutCache && now - homepageLayoutCache.at < LAYOUT_CACHE_TTL) {
    return homepageLayoutCache.data;
  }
  const settings = await getAppSettings();
  const layout = settings?.homepageLayout ? JSON.parse(settings.homepageLayout) : getDefaultLayout();
  homepageLayoutCache = { data: layout, at: now };
  return layout;
}

export async function homepageRoutes(app: FastifyInstance) {
  // GET /homepage — Returns the current layout or default
  app.get('/homepage', async () => {
    const settings = await getAppSettings();
    if (settings?.homepageLayout) {
      return JSON.parse(settings.homepageLayout);
    }
    return getDefaultLayout();
  });

  // PUT /homepage — Save layout (receives JSON array or { sections, reset })
  app.put('/homepage', async (request, reply) => {
    const body = request.body as { sections?: any[]; reset?: boolean } | any[];
    const sections = Array.isArray(body) ? body : body.sections;

    // Handle reset
    if (!Array.isArray(body) && (body as any).reset) {
      await patchAppSettings({ homepageLayout: null });
      homepageLayoutCache = null;
      return { ok: true, sections: getDefaultLayout() };
    }

    if (!Array.isArray(sections)) {
      return reply.status(400).send({ error: 'Layout must be an array or { sections: [...] }' });
    }

    // Basic validation: each item must have id, type, enabled, title
    for (const s of sections) {
      if (!s.id || !s.type || typeof s.enabled !== 'boolean' || !s.title) {
        return reply.status(400).send({ error: 'Each section must have id, type, enabled, and title' });
      }
    }
    await patchAppSettings({ homepageLayout: JSON.stringify(sections) });
    // Invalidate the public layout cache
    invalidateHomepageLayoutCache();
    return { ok: true };
  });

  // POST /homepage/preview — Preview a TMDB discover query (returns results)
  app.post('/homepage/preview', async (request, reply) => {
    const query = request.body as DiscoverQuery;

    const params = buildDiscoverParams(query);
    params.set('page', '1');

    // Static-path selector — no user input in the URL (prevents SSRF / CodeQL alert).
    const discoverPath = query.mediaType === 'movie' ? '/discover/movie' : query.mediaType === 'tv' ? '/discover/tv' : null;
    if (!discoverPath) {
      return reply.status(400).send({ error: 'Invalid mediaType' });
    }
    const api = getTmdbApi();
    const { data } = await api.get(discoverPath, { params: Object.fromEntries(params) });
    return data;
  });
}
