import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { hasPlaintextSecret, hasUndecryptableSecret } from '../../utils/secrets.js';

interface FlaggedServiceSummary {
  id: number;
  name: string;
  type: string;
  /** "plaintext" = sensitive field never got encrypted (legacy row, awaiting first re-save).
   *  "undecryptable" = encrypted with a different master key (cross-env import / rotation /
   *  lost key) — credentials must be re-entered for the service to work. */
  reason: 'plaintext' | 'undecryptable';
}

/**
 * Security-focused admin endpoints. Drives the bottom-right banner that prompts the admin to
 * re-enter credentials whenever a Service row carries either:
 *   - a plaintext sensitive value (pre-encryption legacy data), or
 *   - an `enc:v1:` ciphertext that fails to decrypt under the current master key.
 * Re-saving the service runs the value back through `encryptServiceConfig` with the live key.
 */
export async function securityAdminRoutes(app: FastifyInstance) {
  app.get('/security/services-needing-reencryption', async () => {
    const services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, config: true },
    });
    const flagged: FlaggedServiceSummary[] = [];
    for (const s of services) {
      let parsed: Record<string, string>;
      try {
        parsed = JSON.parse(s.config) as Record<string, string>;
      } catch { continue; }
      if (hasPlaintextSecret(parsed)) {
        flagged.push({ id: s.id, name: s.name, type: s.type, reason: 'plaintext' });
      } else if (hasUndecryptableSecret(parsed)) {
        flagged.push({ id: s.id, name: s.name, type: s.type, reason: 'undecryptable' });
      }
    }
    return { services: flagged };
  });
}
