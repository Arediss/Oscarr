import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { getAppSettings } from '../../utils/appSettings.js';
import { logEvent } from '../../utils/logEvent.js';
import { parseId } from '../../utils/params.js';
import { getServiceConfig } from '../../utils/services.js';
import { getPlexToken } from '../../providers/plex/index.js';
import { getSharedServerUsers, removeSharedServer } from '../../providers/plex/client.js';

export async function plexAdminRoutes(app: FastifyInstance) {
  app.delete('/plex/shared/:userId', {
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string', description: 'Oscarr user ID' } },
      },
    },
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const targetId = parseId(userId);
    if (!targetId) return reply.status(400).send({ error: 'Invalid userId' });

    const token = await getPlexToken(request.user.id);
    if (!token) return reply.status(400).send({ error: 'No Plex admin token available' });

    const settings = await getAppSettings();
    let machineId = settings?.plexMachineId;
    if (!machineId) {
      const cfg = await getServiceConfig('plex');
      machineId = cfg?.machineId || null;
    }
    if (!machineId) return reply.status(400).send({ error: 'No Plex machine ID configured' });

    const plexProvider = await prisma.userProvider.findUnique({
      where: { userId_provider: { userId: targetId, provider: 'plex' } },
    });
    if (!plexProvider?.providerId) {
      return reply.status(404).send({ error: 'Target user has no Plex account linked' });
    }

    const targetPlexId = Number.parseInt(plexProvider.providerId, 10);
    if (!Number.isFinite(targetPlexId)) {
      return reply.status(500).send({ error: 'Target Plex user ID is malformed' });
    }

    let sharedUsers;
    try {
      sharedUsers = await getSharedServerUsers(token, machineId);
    } catch (err) {
      logEvent('error', 'Plex', `Failed to list shared servers: ${String(err)}`);
      return reply.status(502).send({ error: 'Unable to query Plex shared servers' });
    }

    const match = sharedUsers.find((u) => u.id === targetPlexId);
    if (!match) {
      return reply.status(404).send({ error: 'User is not currently shared with this server' });
    }
    if (!match.shareId) {
      return reply.status(500).send({ error: 'Could not resolve share ID from Plex response' });
    }

    try {
      await removeSharedServer(token, machineId, match.shareId);
    } catch (err) {
      logEvent('error', 'Plex', `Failed to remove shared server ${match.shareId}: ${String(err)}`);
      return reply.status(502).send({ error: 'Plex rejected the unshare request' });
    }

    logEvent('info', 'Plex', `Admin #${request.user.id} unshared Plex access for user #${targetId} (Plex userID ${targetPlexId})`);
    return { ok: true };
  });
}
