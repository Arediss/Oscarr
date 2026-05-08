import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';

const PLAIN_PREFIX = 'oscarr_';

function hashKey(plain: string): string {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

// lastUsedAt is best-effort — we batch updates every 5s to avoid one DB write per request when
// a chatty client (Maintainerr scan, dashboard widget poll) hits us repeatedly.
const _lastUsedQueue = new Map<number, number>();

function flushLastUsed(): void {
  if (_lastUsedQueue.size === 0) return;
  const now = new Date();
  const ids = [..._lastUsedQueue.keys()];
  _lastUsedQueue.clear();
  Promise.allSettled(
    ids.map((id) => prisma.userApiKey.update({ where: { id }, data: { lastUsedAt: now } })),
  ).catch(() => { /* swallow — losing a lastUsedAt update is harmless */ });
}
setInterval(flushLastUsed, 5_000).unref();

/**
 * Resolve an `X-Api-Key` header to its owning user. Returns null if the header is missing,
 * malformed, refers to a revoked key, or maps to a disabled user.
 */
export async function authenticateUserApiKey(
  request: FastifyRequest,
): Promise<{ id: number; role: string; email: string } | null> {
  const headerVal = request.headers['x-api-key'];
  const plain = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!plain || !plain.startsWith(PLAIN_PREFIX)) return null;

  const row = await prisma.userApiKey.findFirst({
    where: { keyHash: hashKey(plain), revokedAt: null },
    select: { id: true, user: { select: { id: true, role: true, email: true, disabled: true } } },
  });
  if (!row?.user || row.user.disabled) return null;

  _lastUsedQueue.set(row.id, Date.now());

  return { id: row.user.id, role: row.user.role, email: row.user.email };
}

/**
 * Fastify preHandler that requires a valid user-scoped API key. Used by the Seerr-compatible
 * API layer (and any future endpoint family meant to be hit by third-party apps rather than
 * the Oscarr SPA). Sets request.user with the same { id, role } shape RBAC expects.
 */
export async function userApiKeyAuthHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authed = await authenticateUserApiKey(request);
  if (!authed) {
    return reply.status(401).send({ error: 'UNAUTHORIZED' });
  }
  // Cast through unknown — request.user's shape is decided by @fastify/jwt's type augmentation,
  // and we're injecting an equivalent JWT-payload shape so downstream handlers don't care.
  (request as unknown as { user: typeof authed }).user = authed;
}
