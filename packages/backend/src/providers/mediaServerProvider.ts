import axios from 'axios';
import { prisma } from '../utils/prisma.js';
import { logEvent } from '../utils/logEvent.js';
import { parseServiceConfig } from '../utils/services.js';
import type { Provider, AuthProvider } from './types.js';
import { isProviderEnabled } from './authSettings.js';
import { refreshUserAvatar } from '../utils/avatarSource.js';

// Emby and Jellyfin speak the same MediaBrowser API (Jellyfin is an Emby fork): identical
// /Users/AuthenticateByName endpoint and X-Emby-* headers. One factory serves both.
const MEDIA_BROWSER_HEADERS = {
  'X-Emby-Authorization': 'MediaBrowser Client="Oscarr", Device="Server", DeviceId="oscarr-server", Version="1.0.0"',
};

interface MediaServerConfig {
  id: string;
  label: string;
  icon: string;
}

export function createMediaServerProvider(server: MediaServerConfig): Provider {
  const { id, label, icon } = server;
  const synthEmail = (name: string) => `${name.toLowerCase().replaceAll(/[^a-z0-9]/g, '')}@${id}.local`;

  async function authenticateByName(serverUrl: string, username: string, password: string) {
    const { data } = await axios.post(
      `${serverUrl}/Users/AuthenticateByName`,
      { Username: username, Pw: password },
      { headers: MEDIA_BROWSER_HEADERS, timeout: 10000 },
    );
    return {
      userId: data.User.Id as string,
      token: data.AccessToken as string,
      user: {
        id: data.User.Id as string,
        name: (data.User.Name || username) as string,
        primaryImageTag: data.User.PrimaryImageTag as string | undefined,
      },
    };
  }

  async function getUsers(serverUrl: string, apiKey: string) {
    const { data } = await axios.get(`${serverUrl}/Users`, {
      headers: { ...MEDIA_BROWSER_HEADERS, 'X-Emby-Token': apiKey },
      timeout: 10000,
    });
    return (data as { Id: string; Name: string; PrimaryImageTag?: string }[]).map(u => ({
      id: u.Id,
      name: u.Name,
      avatar: u.PrimaryImageTag ? `${serverUrl}/Users/${u.Id}/Images/Primary?tag=${u.PrimaryImageTag}` : null,
    }));
  }

  function getAvatarUrl(serverUrl: string, userId: string, imageTag?: string): string | null {
    if (!imageTag) return null;
    return `${serverUrl}/Users/${userId}/Images/Primary?tag=${imageTag}`;
  }

  async function getConfig(): Promise<{ url: string; apiKey: string } | null> {
    const service = await prisma.service.findFirst({ where: { type: id, enabled: true } });
    if (!service) return null;
    const config = parseServiceConfig(service.config);
    return config.url ? { url: config.url, apiKey: config.apiKey || '' } : null;
  }

  const authProvider: AuthProvider = {
    config: {
      id,
      label,
      type: 'credentials',
      configSchema: [
        {
          key: 'allowSignup',
          label: 'Allow new account creation',
          type: 'boolean',
          default: false,
          help: `Auto-create Oscarr users for new ${label} logins.`,
        },
      ],
      requiresService: true,
    },

    async registerRoutes(app, helpers) {
      app.post(`/${id}/login`, {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          body: {
            type: 'object' as const,
            required: ['username', 'password'],
            properties: {
              username: { type: 'string' as const },
              password: { type: 'string' as const },
            },
          },
        },
      }, async (request, reply) => {
        if (!(await isProviderEnabled(id))) {
          return reply.status(403).send({ error: 'PROVIDER_DISABLED' });
        }
        const { username, password } = request.body as { username: string; password: string };

        const cfg = await getConfig();
        if (!cfg) return reply.status(503).send({ error: `${label} server not configured` });
        const serverUrl = cfg.url;

        try {
          const auth = await authenticateByName(serverUrl, username, password);
          const avatar = getAvatarUrl(serverUrl, auth.user.id, auth.user.primaryImageTag);

          const result = await helpers.findOrCreateUser({
            provider: id,
            providerId: auth.userId,
            providerToken: auth.token,
            providerUsername: auth.user.name,
            email: synthEmail(auth.user.name),
            displayName: auth.user.name,
            avatar,
          });

          logEvent('info', 'Auth', `${result.displayName} logged in (${id})${result.isNew ? ' — new account' : ''}`);
          return helpers.signAndSend(reply, result.id);
        } catch (err) {
          if ((err as Error).message === 'SIGNUP_NOT_ALLOWED') {
            return reply.status(403).send({ error: 'SIGNUP_NOT_ALLOWED' });
          }
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === 401) return reply.status(401).send({ error: 'Invalid username or password' });
          logEvent('warn', 'Auth', `${label} auth failed for "${username}": ${String(err)}`);
          return reply.status(500).send({ error: 'Authentication failed' });
        }
      });
    },

    async linkAccountByCredentials(username, password, userId) {
      const cfg = await getConfig();
      if (!cfg) throw new Error('NOT_CONFIGURED');
      const serverUrl = cfg.url;

      const auth = await authenticateByName(serverUrl, username, password);

      const existing = await prisma.userProvider.findUnique({
        where: { provider_providerId: { provider: id, providerId: auth.userId } },
      });
      if (existing && existing.userId !== userId) throw new Error('PROVIDER_ALREADY_LINKED');

      const avatar = getAvatarUrl(serverUrl, auth.user.id, auth.user.primaryImageTag);
      await prisma.userProvider.upsert({
        where: { userId_provider: { userId, provider: id } },
        update: { providerId: auth.userId, providerToken: auth.token, providerUsername: auth.user.name, providerAvatar: avatar ?? null },
        create: { userId, provider: id, providerId: auth.userId, providerToken: auth.token, providerUsername: auth.user.name, providerAvatar: avatar ?? null },
      });
      await refreshUserAvatar(userId);

      logEvent('info', 'Auth', `${label} account linked: ${auth.user.name}`);
      return { providerUsername: auth.user.name };
    },

    async importUsers(_adminUserId, filter) {
      const cfg = await getConfig();
      if (!cfg?.apiKey) throw new Error('NO_TOKEN');
      const { url: serverUrl, apiKey } = cfg;

      const allUsers = await getUsers(serverUrl, apiKey);
      const allowed = filter?.providerIds ? new Set(filter.providerIds) : null;
      const users = allowed ? allUsers.filter((u) => allowed.has(u.id)) : allUsers;
      let imported = 0;
      let skipped = 0;

      for (const user of users) {
        const existingProvider = await prisma.userProvider.findUnique({
          where: { provider_providerId: { provider: id, providerId: user.id } },
        });
        if (existingProvider) { skipped++; continue; }

        const email = synthEmail(user.name);
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) { skipped++; continue; }

        await prisma.user.create({
          data: {
            email,
            displayName: user.name,
            avatar: user.avatar,
            role: 'user',
            providers: {
              create: {
                provider: id,
                providerId: user.id,
                providerUsername: user.name,
              },
            },
          },
        });
        imported++;
      }

      logEvent('info', 'User', `Import ${label}: ${imported} imported, ${skipped} existing`);
      return { imported, skipped, total: users.length };
    },

    // Minimal sync: these servers have no "share revoked" equivalent, so no enable/disable pass.
    // We surface users on the server without a matching Oscarr account so the admin can
    // cherry-pick imports through the same review modal as Plex.
    async syncUsers(_adminUserId) {
      const cfg = await getConfig();
      if (!cfg?.apiKey) throw new Error('NO_TOKEN');
      const { url: serverUrl, apiKey } = cfg;

      const users = await getUsers(serverUrl, apiKey);
      const linked = await prisma.userProvider.findMany({
        where: { provider: id },
        select: { providerId: true },
      });
      const linkedIds = new Set(linked.map((l) => l.providerId).filter((pid): pid is string => !!pid));

      const pendingImports = users
        .filter((u) => !linkedIds.has(u.id))
        .map((u) => ({ providerId: u.id, providerUsername: u.name, providerEmail: null }));

      return { enabled: 0, disabled: 0, pendingImports };
    },
  };

  return {
    service: {
      id,
      label,
      icon,
      category: 'media-server',
      requiredForInstall: true,
      fields: [
        { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:8096' },
        { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
      ],
      async test(config) {
        const { data } = await axios.get(`${config.url}/System/Info/Public`, { timeout: 5000 });
        return { ok: true, version: data.Version };
      },
    },
    auth: authProvider,
  };
}
