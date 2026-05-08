import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';

const PLAIN_PREFIX = 'oscarr_';
const KEY_BYTES = 32; // 256-bit entropy
const PREFIX_DISPLAY_CHARS = PLAIN_PREFIX.length + 5; // "oscarr_" + 5 hex chars
const MAX_NAME_LENGTH = 80;

function generatePlainKey(): string {
  return PLAIN_PREFIX + crypto.randomBytes(KEY_BYTES).toString('hex');
}

function hashKey(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function plainPrefix(plain: string): string {
  return plain.slice(0, PREFIX_DISPLAY_CHARS);
}

/**
 * Admin-managed API keys for third-party app integrations (Doplarr, Maintainerr, mobile Seerr
 * clients, …). Each key is owned by the admin who generated it; requests authenticated with the
 * key act on behalf of that admin. Distinct from `AppSettings.apiKey` (the legacy global key
 * used by /webhooks and /health) — that one stays as-is for service-to-service calls.
 */
export async function apiKeysAdminRoutes(app: FastifyInstance) {
  app.get('/api-keys', async (request) => {
    const user = request.user as { id: number };
    return prisma.userApiKey.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
    });
  });

  app.post<{ Body: { name?: string } }>('/api-keys', async (request, reply) => {
    const user = request.user as { id: number };
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
    const user = request.user as { id: number };
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.status(400).send({ error: 'INVALID_ID' });

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
