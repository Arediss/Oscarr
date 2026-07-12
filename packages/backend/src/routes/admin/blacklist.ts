import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { logEvent } from '../../utils/logEvent.js';
import { parseId } from '../../utils/params.js';

export async function blacklistRoutes(app: FastifyInstance) {

  // List all blacklisted media
  app.get('/blacklist', async () => {
    return prisma.blacklistedMedia.findMany({
      include: { createdBy: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  // Add media to blacklist
  app.post('/blacklist', {
    schema: {
      body: {
        type: 'object',
        required: ['tmdbId', 'mediaType', 'title'],
        properties: {
          tmdbId: { type: 'number' },
          mediaType: { type: 'string', enum: ['movie', 'tv'] },
          title: { type: 'string' },
          posterPath: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user;
    const { tmdbId, mediaType, title, posterPath, reason } = request.body as { tmdbId: number; mediaType: string; title: string; posterPath?: string; reason?: string };

    const existing = await prisma.blacklistedMedia.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
    });
    if (existing) return reply.status(409).send({ error: 'Already blacklisted' });

    const entry = await prisma.blacklistedMedia.create({
      data: { tmdbId, mediaType, title, posterPath: posterPath || null, reason: reason || null, createdById: user.id },
    });

    logEvent('info', 'Blacklist', `"${title}" added to blacklist`);
    return reply.status(201).send(entry);
  });

  // Remove from blacklist
  app.delete('/blacklist/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (!id) return reply.status(400).send({ error: 'Invalid ID' });

    const entry = await prisma.blacklistedMedia.findUnique({ where: { id } });
    if (!entry) return reply.status(404).send({ error: 'Not found' });

    await prisma.blacklistedMedia.delete({ where: { id } });
    logEvent('info', 'Blacklist', `"${entry.title}" removed from blacklist`);
    return reply.send({ ok: true });
  });

  // Check if a media is blacklisted (used by frontend)
  app.get('/blacklist/check', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tmdbId: { type: 'string' },
          mediaType: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { tmdbId, mediaType } = request.query as { tmdbId?: string; mediaType?: string };
    if (!tmdbId || !mediaType) return { blacklisted: false };
    const entry = await prisma.blacklistedMedia.findUnique({
      where: { tmdbId_mediaType: { tmdbId: Number.parseInt(tmdbId, 10), mediaType } },
    });
    return { blacklisted: !!entry, reason: entry?.reason || null };
  });
}
