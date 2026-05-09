import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { hasPlaintextSecret } from '../../utils/secrets.js';

interface PlaintextServiceSummary {
  id: number;
  name: string;
  type: string;
}

/**
 * Security-focused admin endpoints. Right now the only consumer is the "your stored
 * credentials are still in plaintext, please re-enter them" banner — an admin clicks through
 * to the Services tab and re-saves each one to trigger encryption-on-write.
 */
export async function securityAdminRoutes(app: FastifyInstance) {
  app.get('/security/services-needing-reencryption', async () => {
    const services = await prisma.service.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, config: true },
    });
    const flagged: PlaintextServiceSummary[] = [];
    for (const s of services) {
      let parsed: Record<string, string>;
      try {
        parsed = JSON.parse(s.config) as Record<string, string>;
      } catch { continue; }
      if (hasPlaintextSecret(parsed)) {
        flagged.push({ id: s.id, name: s.name, type: s.type });
      }
    }
    return { services: flagged };
  });
}
