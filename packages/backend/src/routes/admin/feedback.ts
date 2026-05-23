import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { pluginEngine } from '../../plugins/engine.js';
import { getOscarrVersion } from '../../plugins/compat.js';

const ALLOWED_SECTIONS = new Set(['tech', 'plugins', 'logs']);
const LOG_LINE_LIMIT = 50;

/** Admin-only endpoint feeding the FeedbackModal. Each section is opt-in via `include` —
 *  the modal pre-fetches the metadata it needs based on which checkboxes the admin ticked
 *  so previews stay accurate. The actual submission goes directly from the browser to the
 *  Cloudflare Worker, not through this backend — we only generate the data here. */
export async function feedbackRoutes(app: FastifyInstance) {
  app.get('/feedback/metadata', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          include: {
            type: 'string',
            description: 'Comma-separated list of sections to include. Accepted: tech, plugins, logs',
          },
        },
      },
    },
  }, async (request) => {
    const { include } = request.query as { include?: string };
    const requested = new Set(
      (include ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => ALLOWED_SECTIONS.has(s)),
    );

    const result: {
      tech?: { oscarrVersion: string; nodeVersion: string; platform: string; arch: string };
      plugins?: Array<{ id: string; version: string; enabled: boolean }>;
      logs?: Array<{ createdAt: string; level: string; label: string; body: string }>;
    } = {};

    if (requested.has('tech')) {
      result.tech = {
        oscarrVersion: getOscarrVersion(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      };
    }

    if (requested.has('plugins')) {
      result.plugins = pluginEngine.getPluginList().map((p) => ({
        id: p.id,
        version: p.version,
        enabled: p.enabled,
      }));
    }

    if (requested.has('logs')) {
      const lines = await prisma.appLog.findMany({
        where: { level: { in: ['error', 'warn'] } },
        orderBy: { createdAt: 'desc' },
        take: LOG_LINE_LIMIT,
        select: { createdAt: true, level: true, label: true, message: true },
      });
      // Reverse so the response reads chronologically — UI preview prints them top-to-bottom.
      result.logs = lines.reverse().map((l) => ({
        createdAt: l.createdAt.toISOString(),
        level: l.level,
        label: l.label,
        body: l.message,
      }));
    }

    return result;
  });
}
