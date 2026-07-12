import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { generatePlainKey, hashKey, plainPrefix } from '../../utils/userApiKey.js';
import { parseId } from '../../utils/params.js';

const MAX_NAME_LENGTH = 80;

/**
 * Admin-managed API keys for third-party app integrations (Doplarr, Maintainerr, mobile Seerr
 * clients, …). Each key is owned by the admin who generated it; requests authenticated with the
 * key act on behalf of that admin. Distinct from `AppSettings.apiKey` (the legacy global key
 * used by /webhooks and /health) — that one stays as-is for service-to-service calls.
 */
export async function apiKeysAdminRoutes(app: FastifyInstance) {
  app.get('/api-keys', async (request) => {
    const user = request.user;
    return prisma.userApiKey.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
    });
  });

  app.post<{ Body: { name?: string } }>('/api-keys', async (request, reply) => {
    const user = request.user;
    const name = (request.body?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'NAME_REQUIRED' });
    if (name.length > MAX_NAME_LENGTH) return reply.status(400).send({ error: 'NAME_TOO_LONG' });

    const plain = generatePlainKey();
    const created = await prisma.userApiKey.create({
      data: {
        userId: user.id,
        name,
        keyHash: hashKey(plain),
        prefix: plainPrefix(plain),
      },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    // Plain key returned ONCE — caller must persist it now; we only store the hash server-side.
    return reply.send({ ...created, key: plain });
  });

  app.delete<{ Params: { id: string } }>('/api-keys/:id', async (request, reply) => {
    const user = request.user;
    const id = parseId(request.params.id);
    if (!id) return reply.status(400).send({ error: 'INVALID_ID' });

    const existing = await prisma.userApiKey.findFirst({
      where: { id, userId: user.id, revokedAt: null },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });

    await prisma.userApiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });
}
