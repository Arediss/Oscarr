import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { notificationRegistry } from '../../notifications/index.js';
import { parseNotificationSettings, parseRawNotificationSettings } from '../../notifications/providerConfig.js';
import { mergeSecretFields } from '../../utils/secrets.js';

export async function notificationsAdminRoutes(app: FastifyInstance) {
  // === NOTIFICATION TEST (dynamic) ===
  app.post<{ Params: { providerId: string } }>('/notifications/test/:providerId', {
    schema: {
      params: {
        type: 'object',
        required: ['providerId'],
        properties: { providerId: { type: 'string' } },
      },
      body: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
    },
  }, async (request, reply) => {
    const { providerId } = request.params;
    const settings = request.body as Record<string, string>;
    try {
      await notificationRegistry.testProvider(providerId, settings);
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({ error: `Test failed for ${providerId}` });
    }
  });

  // Get registry metadata (providers + event types) for the frontend
  app.get('/notifications/meta', async () => {
    return notificationRegistry.toJSON();
  });

  // Get all provider configs from DB. Settings are stored encrypted at rest; admins get them
  // back in clear here, same contract as Service configs — the panel is where credentials are
  // edited, and RBAC + CSRF already gate it.
  app.get('/notifications/providers', async () => {
    const rows = await prisma.notificationProviderConfig.findMany();
    return rows.map((row) => ({ ...row, settings: JSON.stringify(parseNotificationSettings(row.settings)) }));
  });

  // Save a provider's config
  app.put<{ Params: { providerId: string } }>('/notifications/providers/:providerId', {
    schema: {
      params: {
        type: 'object',
        required: ['providerId'],
        properties: { providerId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          settings: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
  }, async (request) => {
    const { providerId } = request.params;
    const { enabled, settings } = request.body as { enabled?: boolean; settings?: Record<string, string> };

    // Merge onto the blob as stored rather than replacing it. The panel posts every provider's
    // full settings on any save — including the '' that decryptSecretFields yields for a value
    // this instance can't read — so a plain overwrite turned one click into permanent credential
    // loss after a key rotation or a cross-environment restore. See mergeSecretFields.
    const existing = await prisma.notificationProviderConfig.findUnique({ where: { providerId } });
    const merged = settings
      ? mergeSecretFields(parseRawNotificationSettings(existing?.settings), settings)
      : undefined;

    return prisma.notificationProviderConfig.upsert({
      where: { providerId },
      update: {
        ...(enabled !== undefined && { enabled }),
        ...(merged && { settings: JSON.stringify(merged) }),
      },
      create: {
        providerId,
        enabled: enabled ?? false,
        settings: merged ? JSON.stringify(merged) : '{}',
      },
    });
  });
}
