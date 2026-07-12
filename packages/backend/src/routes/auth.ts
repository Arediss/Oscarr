import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { getAppSettings } from '../utils/appSettings.js';
import { logEvent } from '../utils/logEvent.js';
import { registerEmail, loginEmail } from '../providers/email/index.js';
import { getAuthProviders, getAuthProvider, getAuthProviderConfigs } from '../providers/index.js';
import { getProviderConfig, isProviderEnabled } from '../providers/authSettings.js';
import type { AuthHelpers } from '../providers/types.js';
import { getPermissionsForRole } from '../middleware/rbac.js';
import { refreshUserAvatar } from '../utils/avatarSource.js';
import { setAuthCookie } from '../utils/authCookie.js';

function buildHelpers(app: FastifyInstance): AuthHelpers {
  return {
    async signAndSend(reply, userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { providers: true },
      });
      if (!user) return reply.status(500).send({ error: 'User not found after auth' });

      if (user.disabled) {
        const appSettings = await getAppSettings();
        const mode = appSettings?.disabledLoginMode ?? 'friendly';
        if (mode === 'friendly') {
          return reply.status(403).send({ error: 'ACCOUNT_DISABLED' });
        }
        return reply.status(401).send({ error: 'INVALID_CREDENTIALS' });
      }

      return setAuthCookie(reply, app, user)
        .send({
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            avatar: user.avatar,
            role: user.role,
            providers: user.providers.map((p) => ({ provider: p.provider, username: p.providerUsername, email: p.providerEmail })),
          },
        });
    },

    async findOrCreateUser(opts) {
      const existingProvider = opts.providerId
        ? await prisma.userProvider.findUnique({
            where: { provider_providerId: { provider: opts.provider, providerId: opts.providerId } },
            include: { user: { include: { providers: true } } },
          })
        : null;

      let user = existingProvider?.user;
      if (!user) {
        const byEmail = await prisma.user.findUnique({
          where: { email: opts.email },
          include: { providers: true },
        });
        if (byEmail) {
          // Synthetic provider emails (`*@jellyfin.local`, `*@discord.local` …) can collide
          // with a real user-supplied email. Log the merge so admins have a breadcrumb if the
          // wrong account ends up linked to an external identity.
          logEvent('warn', 'Auth', `findOrCreateUser: linking "${opts.provider}" identity ${opts.providerId ?? '?'} to existing user ${byEmail.id} via email match (${opts.email})`);
          user = byEmail;
        }
      }

      const userCount = await prisma.user.count();
      const isFirstUser = userCount === 0;

      if (!user) {
        // Per-provider signup gate, secure-by-default: each AuthProvider has its own
        // `allowSignup` toggle (including email). Admin opts-in explicitly per channel, no
        // global master switch to reason about. Bootstrapping bypasses so a fresh install
        // can create its first admin.
        if (!isFirstUser) {
          const providerCfg = await getProviderConfig(opts.provider);
          if (providerCfg.allowSignup !== true) {
            throw new Error('SIGNUP_NOT_ALLOWED');
          }
        }
        user = await prisma.user.create({
          data: {
            email: opts.email,
            displayName: opts.displayName,
            avatar: opts.avatar,
            role: isFirstUser ? 'admin' : 'user',
            providers: {
              create: {
                provider: opts.provider,
                providerId: opts.providerId,
                providerToken: opts.providerToken,
                providerUsername: opts.providerUsername,
                providerEmail: opts.providerEmail,
                providerAvatar: opts.avatar ?? null,
              },
            },
          },
          include: { providers: true },
        });
        return { ...user, isNew: true };
      }

      await prisma.userProvider.upsert({
        where: { userId_provider: { userId: user.id, provider: opts.provider } },
        update: {
          providerId: opts.providerId,
          providerToken: opts.providerToken,
          providerUsername: opts.providerUsername,
          providerEmail: opts.providerEmail,
          providerAvatar: opts.avatar ?? null,
        },
        create: {
          userId: user.id,
          provider: opts.provider,
          providerId: opts.providerId,
          providerToken: opts.providerToken,
          providerUsername: opts.providerUsername,
          providerEmail: opts.providerEmail,
          providerAvatar: opts.avatar ?? null,
        },
      });

      // Display name still merges from the provider on first contact, but we let
      // refreshUserAvatar own the avatar field — it picks the right URL based on the user's
      // chosen avatarSource (or the first available one for legacy accounts).
      await prisma.user.update({
        where: { id: user.id },
        data: { displayName: user.displayName || opts.displayName },
      });
      await refreshUserAvatar(user.id);
      user = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { providers: true },
      });

      return { ...user, isNew: false };
    },
  };
}

export async function authRoutes(app: FastifyInstance) {
  const helpers = buildHelpers(app);

  // GET /providers — list available auth providers for the login page
  app.get('/providers', async () => getAuthProviderConfigs());

  // ─── Email/Password (built-in) ────────────────────────────────────

  app.post('/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object' as const,
        required: ['email', 'password', 'displayName'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
          displayName: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, displayName } = request.body as { email: string; password: string; displayName: string };

    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;

    if (!isFirstUser) {
      // Provider enablement: an admin who flips Email off should fully shut down email-based
      // registration, not just hide the button on the login page.
      if (!(await isProviderEnabled('email'))) {
        return reply.status(403).send({ error: 'PROVIDER_DISABLED' });
      }
      // Email signup is gated by email's own allowSignup toggle (same per-provider model as
      // Plex/Jellyfin/Emby/Discord). Admin manages it from Authentication → Email.
      const emailCfg = await getProviderConfig('email');
      if (emailCfg.allowSignup !== true) {
        return reply.status(403).send({ error: 'SIGNUP_NOT_ALLOWED' });
      }
    }

    try {
      const result = await registerEmail(email, password, displayName);
      const user = await prisma.user.create({
        data: {
          email: result.email,
          displayName: result.displayName,
          passwordHash: result.providerData.passwordHash as string,
          role: isFirstUser ? 'admin' : 'user',
          providers: { create: { provider: 'email', providerId: result.email, providerUsername: result.displayName, providerEmail: result.email } },
        },
      });

      logEvent('info', 'Auth', `New email account created: ${result.displayName} (${isFirstUser ? 'admin' : 'user'})`);
      return helpers.signAndSend(reply, user.id);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'EMAIL_EXISTS') return reply.status(409).send({ error: 'EMAIL_EXISTS' });
      if (msg === 'PASSWORD_TOO_SHORT') return reply.status(400).send({ error: 'PASSWORD_TOO_SHORT' });
      if (msg === 'DISPLAY_NAME_REQUIRED') return reply.status(400).send({ error: 'DISPLAY_NAME_REQUIRED' });
      throw err;
    }
  });

  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object' as const,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (!(await isProviderEnabled('email'))) {
      return reply.status(403).send({ error: 'PROVIDER_DISABLED' });
    }
    const { email, password } = request.body as { email: string; password: string };

    try {
      await loginEmail(email, password);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'INVALID_CREDENTIALS') return reply.status(401).send({ error: 'INVALID_CREDENTIALS' });
      if (msg === 'EXTERNAL_ACCOUNT') return reply.status(400).send({ error: 'EXTERNAL_ACCOUNT' });
      throw err;
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return reply.status(401).send({ error: 'INVALID_CREDENTIALS' });

    logEvent('info', 'Auth', `${user.displayName} logged in (email)`);
    return helpers.signAndSend(reply, user.id);
  });

  // ─── Register all OAuth providers from registry ───────────────────

  for (const provider of getAuthProviders()) {
    await provider.registerRoutes(app, helpers);
  }

  // ─── Link provider to current account ─────────────────────────────

  app.post('/link-provider', {
    schema: {
      body: {
        type: 'object' as const,
        required: ['provider'],
        properties: {
          provider: { type: 'string' },
          pinId: { type: 'number' },
          username: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },

  }, async (request, reply) => {
    const currentUser = request.user;
    const { provider: providerId, pinId, username, password } = request.body as {
      provider: string; pinId?: number; username?: string; password?: string;
    };

    const provider = getAuthProvider(providerId);
    if (!provider) return reply.status(400).send({ error: 'UNKNOWN_PROVIDER' });

    try {
      let result: { providerUsername: string };
      if (username && password && provider.linkAccountByCredentials) {
        result = await provider.linkAccountByCredentials(username, password, currentUser.id);
      } else if (pinId && provider.linkAccount) {
        result = await provider.linkAccount(pinId, currentUser.id);
      } else {
        return reply.status(400).send({ error: 'PROVIDER_LINKING_NOT_SUPPORTED' });
      }
      return reply.send({ success: true, providerUsername: result.providerUsername });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'PIN_INVALID') return reply.status(400).send({ error: 'PIN_INVALID' });
      if (msg === 'PROVIDER_ALREADY_LINKED') return reply.status(409).send({ error: 'PROVIDER_ALREADY_LINKED' });
      if (msg === 'NOT_CONFIGURED') return reply.status(503).send({ error: 'PROVIDER_NOT_CONFIGURED' });
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) return reply.status(401).send({ error: 'INVALID_CREDENTIALS' });
      throw err;
    }
  });

  // ─── Common ────────────────────────────────────────────────────────

  app.get('/me', async (request, reply) => {
    const { id } = request.user;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, displayName: true, avatar: true, avatarSource: true, avatarConfig: true, role: true, createdAt: true,
        providers: { select: { provider: true, providerUsername: true, providerEmail: true, providerAvatar: true } },
      },
    });
    if (!user) return reply.status(404).send({ error: 'USER_NOT_FOUND' });
    const permissions = getPermissionsForRole(user.role);
    // Normalize provider keys to the shorter form already used by signAndSend (and by the
    // frontend `UserProviderInfo` type) — also exposes `avatar` per provider so the picker
    // can preview each option.
    const providers = user.providers.map((p) => ({
      provider: p.provider,
      username: p.providerUsername,
      email: p.providerEmail,
      avatar: p.providerAvatar,
    }));
    return reply.send({ ...user, providers, permissions });
  });

  // PUT /me/avatar-source — Issue #169. Lets the user pick which linked provider supplies their
  // avatar, "none" for initials, or "dicebear" for a self-generated SVG. Provider sources are
  // validated against actual linkage. Dicebear stores the editor config + the rendered data URI
  // (computed client-side so the backend stays free of the dicebear deps).
  app.put('/me/avatar-source', {
    schema: {
      body: {
        type: 'object' as const,
        required: ['source'],
        properties: {
          source: { type: 'string' as const },
          config: { type: 'object' as const, additionalProperties: true },
          avatar: { type: 'string' as const },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.user;
    const { source, config, avatar } = request.body as {
      source: string;
      config?: { style?: string; seed?: string; options?: Record<string, unknown> };
      avatar?: string;
    };

    if (source === 'dicebear') {
      if (!avatar?.startsWith('data:image/svg+xml')) {
        return reply.status(400).send({ error: 'INVALID_AVATAR' });
      }
      // Cap to ~100KB to keep the User row lean. SVGs from dicebear are typically 2-6KB so this
      // is generous; mostly a safety net against pasted attacks.
      if (avatar.length > 100_000) return reply.status(413).send({ error: 'AVATAR_TOO_LARGE' });
      if (!config || typeof config.style !== 'string' || typeof config.seed !== 'string') {
        return reply.status(400).send({ error: 'INVALID_CONFIG' });
      }
      const serializedConfig = JSON.stringify(config);
      if (serializedConfig.length > 5_000) return reply.status(413).send({ error: 'CONFIG_TOO_LARGE' });
      await prisma.user.update({
        where: { id },
        data: {
          avatarSource: 'dicebear',
          avatarConfig: serializedConfig,
          avatar,
        },
      });
      return reply.send({ avatarSource: 'dicebear', avatar });
    }

    if (source !== 'none') {
      const linked = await prisma.userProvider.findUnique({
        where: { userId_provider: { userId: id, provider: source } },
        select: { id: true },
      });
      if (!linked) return reply.status(400).send({ error: 'PROVIDER_NOT_LINKED' });
    }

    // Keep avatarConfig untouched when switching to a non-dicebear source — the user can come
    // back to their custom avatar later (clicking the "Oscarr" tile restores it without re-editing).
    await prisma.user.update({ where: { id }, data: { avatarSource: source } });
    const resolved = await refreshUserAvatar(id);
    return reply.send({ avatarSource: source, avatar: resolved });
  });

  app.post('/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' }).send({ ok: true });
  });
}
