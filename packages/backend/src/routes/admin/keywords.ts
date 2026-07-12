import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { invalidateNsfwIdsCache } from '../media.js';
import { parseId } from '../../utils/params.js';

export async function keywordsRoutes(app: FastifyInstance) {
  // === KEYWORDS ===

  app.get('/keywords', async () => {
    const keywords = await prisma.keyword.findMany({ orderBy: { name: 'asc' } });

    // Count media per keyword
    const allMedia = await prisma.media.findMany({
      where: { keywordIds: { not: null } },
      select: { keywordIds: true },
    });

    const counts: Record<number, number> = {};
    for (const m of allMedia) {
      const ids: number[] = JSON.parse(m.keywordIds!);
      for (const id of ids) {
        counts[id] = (counts[id] || 0) + 1;
      }
    }

    return keywords.map((k) => ({
      ...k,
      mediaCount: counts[k.tmdbId] || 0,
    }));
  });

  app.patch('/keywords/:tmdbId', {
    schema: {
      params: {
        type: 'object' as const,
        required: ['tmdbId'],
        properties: {
          tmdbId: { type: 'string', description: 'TMDB keyword ID' },
        },
      },
      body: {
        type: 'object' as const,
        properties: {
          tag: { type: ['string', 'null'], description: 'Tag for this keyword (e.g. "nsfw", "anime") or null to clear' },
        },
      },
    },
  }, async (request, reply) => {
    const { tmdbId } = request.params as { tmdbId: string };
    const { tag } = request.body as { tag: string | null };
    const id = parseId(tmdbId);
    if (!id) return reply.status(400).send({ error: 'Invalid tmdbId' });

    const keyword = await prisma.keyword.findUnique({ where: { tmdbId: id } });
    if (!keyword) return reply.status(404).send({ error: 'Keyword not found' });

    const updated = await prisma.keyword.update({
      where: { tmdbId: id },
      data: { tag: tag || null },
    });
    if (keyword.tag === 'nsfw' || tag === 'nsfw') invalidateNsfwIdsCache();
    return updated;
  });
}
