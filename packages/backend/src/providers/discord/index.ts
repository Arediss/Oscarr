import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AuthHelpers, AuthProvider, Provider } from '../types.js';
import { getProviderConfig, isProviderEnabled } from '../authSettings.js';
import { resolveOAuthCallbackUrl } from '../../utils/publicUrl.js';
import { withRetry } from '../../utils/fetchWithRetry.js';
import { setAuthCookie } from '../../utils/authCookie.js';

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';
const GUILDS_URL = 'https://discord.com/api/users/@me/guilds';
// `guilds` is always requested so admins can optionally gate login by guild membership.
// Users see a "list of servers you're in" consent line — no secret-exchange, just a member check.
const SCOPE = 'identify email guilds';

interface DiscordConfig {
  clientId?: string;
  clientSecret?: string;
  /** Optional: when set, only users who are members of this Discord guild can log in / link. */
  guildId?: string;
}

// Short-lived in-memory store for OAuth `state` → intent. Enough for interactive OAuth round-trips
// (10min TTL); a server restart mid-flow drops pending states, which is acceptable for admins.
// Node-local only: running Oscarr behind a load-balancer with >1 backend would need a shared
// store (Redis etc.) so authorize and callback on different nodes can reconcile. Single-instance
// is the supported topology today.
interface StateRecord {
  intent: 'login' | 'link';
  userId?: number; // present when intent === 'link'
  createdAt: number;
}
const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, StateRecord>();

function gcStates(): void {
  const now = Date.now();
  for (const [k, v] of stateStore) if (now - v.createdAt > STATE_TTL_MS) stateStore.delete(k);
}

interface DiscordConfigResolved {
  clientId: string;
  clientSecret: string;
  guildId?: string; // optional — empty means no guild restriction
}

async function getConfig(): Promise<DiscordConfigResolved> {
  const cfg = (await getProviderConfig('discord')) as DiscordConfig;
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('Discord OAuth is not fully configured');
  }
  return {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    guildId: cfg.guildId || undefined,
  };
}

/**
 * When `guildId` is configured, call Discord's /users/@me/guilds with the user's access token
 * and verify the id is in the list. Fail closed: any non-200 response from Discord, or any
 * error, means the user is rejected. Without this closed-by-default stance an attacker who
 * partially controls upstream could bypass the gate by triggering a 429 / 5xx.
 */
async function isGuildMember(accessToken: string, guildId: string): Promise<boolean> {
  const res = await fetch(GUILDS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return false;
  const guilds = (await res.json()) as Array<{ id?: string }>;
  return Array.isArray(guilds) && guilds.some((g) => g.id === guildId);
}

const discordAuth: AuthProvider = {
  config: {
    id: 'discord',
    label: 'Discord',
    type: 'oauth',
    configSchema: [
      { key: 'clientId', label: 'Application (Client) ID', type: 'string', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
      {
        key: 'guildId',
        label: 'Guild (Server) ID',
        type: 'string',
        required: false,
        help: 'Members-only gate. Developer Mode → right-click server → Copy ID.',
      },
      {
        key: 'allowSignup',
        label: 'Allow new account creation',
        type: 'boolean',
        default: false,
        help: 'Auto-create Oscarr users for new Discord logins.',
      },
    ],
  },

  async registerRoutes(app: FastifyInstance, helpers: AuthHelpers) {
    // ── Authorize: entrypoint for both login and link-to-existing-account flows ──
    app.get<{ Querystring: { action?: string } }>('/discord/authorize', {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      if (!(await isProviderEnabled('discord'))) {
        return reply.redirect('/login?error=PROVIDER_DISABLED');
      }
      gcStates();
      const cfg = await getConfig().catch(() => null);
      if (!cfg) return reply.status(503).send({ error: 'Discord OAuth not configured' });

      const action = request.query.action === 'link' ? 'link' : 'login';
      let userId: number | undefined;
      if (action === 'link') {
        try {
          await request.jwtVerify();
        } catch {
          // Plug-and-play UX: a logged-out user clicking a /link deep link (e.g. from a
          // Discord bot plugin's "Link your account" button) shouldn't get a raw 401 JSON
          // — bounce them through Oscarr's login page with `?next=<this URL>`. After auth,
          // the LoginPage redirects them back here and the JWT cookie is now present, so
          // jwtVerify succeeds and the link flow completes.
          const fullUrl = request.url; // includes /api/auth/discord/authorize?action=link
          return reply.redirect(`/login?next=${encodeURIComponent(fullUrl)}`);
        }
        userId = request.user.id;
      }

      const state = randomUUID();
      stateStore.set(state, { intent: action, userId, createdAt: Date.now() });

      const redirectUri = resolveOAuthCallbackUrl(request, 'discord');
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', cfg.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPE);
      url.searchParams.set('state', state);
      return reply.redirect(url.toString());
    });

    // ── Callback: exchange code → token → user profile, then login or link ──
    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      '/discord/callback',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (request, reply) => {
        if (!(await isProviderEnabled('discord'))) {
          return reply.redirect('/login?error=PROVIDER_DISABLED');
        }
        const { code, state, error } = request.query;
        if (error) {
          // Only echo Discord's documented error codes; coerce anything else to a generic
          // token so an attacker who crafts /api/auth/discord/callback?error=<phishing text>
          // can't phish through the login page error box.
          const KNOWN = new Set(['access_denied', 'invalid_scope', 'server_error', 'temporarily_unavailable']);
          return reply.redirect(`/login?error=${KNOWN.has(error) ? error : 'DISCORD_ERROR'}`);
        }
        if (!code || !state) return reply.redirect('/login?error=DISCORD_ERROR');

        const record = stateStore.get(state);
        if (!record) return reply.redirect('/login?error=DISCORD_ERROR');
        stateStore.delete(state);

        const cfg = await getConfig().catch(() => null);
        if (!cfg) return reply.status(503).send({ error: 'Discord OAuth not configured' });

        // Discord enforces that the redirect_uri on the token exchange matches the one we
        // sent in the authorize request. Re-derive from the same helper so they're identical.
        // withRetry retries once on a transient 5xx so a brief Discord outage mid-OAuth
        // doesn't force a full re-auth from the user — the guild-membership gate below stays
        // fail-closed (no retry) since it's security-critical.
        const redirectUri = resolveOAuthCallbackUrl(request, 'discord');
        const tokenRes = await withRetry(async () => {
          const r = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: cfg.clientId,
              client_secret: cfg.clientSecret,
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
            }),
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          });
          if (r.status >= 500 && r.status < 600) {
            throw Object.assign(new Error(`Discord token ${r.status}`), { response: { status: r.status } });
          }
          return r;
        }, { label: 'DiscordToken' });
        if (!tokenRes.ok) return reply.redirect('/login?error=DISCORD_ERROR');
        const tokenPayload = (await tokenRes.json()) as { access_token?: string };
        if (!tokenPayload.access_token) return reply.redirect('/login?error=DISCORD_ERROR');

        const userRes = await withRetry(async () => {
          const r = await fetch(USER_URL, {
            headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          });
          if (r.status >= 500 && r.status < 600) {
            throw Object.assign(new Error(`Discord user ${r.status}`), { response: { status: r.status } });
          }
          return r;
        }, { label: 'DiscordUser' });
        if (!userRes.ok) return reply.redirect('/login?error=DISCORD_ERROR');
        const profile = (await userRes.json()) as {
          id: string;
          username: string;
          email?: string;
          global_name?: string;
          avatar?: string | null;
        };
        // Discord serves custom avatars from the CDN; the `avatar` field is just the hash. The
        // `a_` prefix marks animated avatars (we keep PNG anyway for size). Skip default avatars
        // entirely — they're bland fallbacks the user likely doesn't want.
        const discordAvatarUrl = profile.avatar
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=256`
          : null;

        // Guild gate — applies to both login and link flows. Keeps Oscarr access scoped to a
        // known community so random Discord users can't create accounts by hitting the button.
        if (cfg.guildId) {
          const member = await isGuildMember(tokenPayload.access_token, cfg.guildId).catch(() => false);
          if (!member) return reply.redirect('/login?error=DISCORD_GUILD_DENIED');
        }

        if (record.intent === 'link' && record.userId) {
          // Attach this Discord identity to the already-authenticated user.
          const { prisma } = await import('../../utils/prisma.js');
          await prisma.userProvider.upsert({
            where: { provider_providerId: { provider: 'discord', providerId: profile.id } },
            update: {
              userId: record.userId,
              providerUsername: profile.username,
              providerEmail: profile.email ?? null,
              providerAvatar: discordAvatarUrl,
            },
            create: {
              userId: record.userId,
              provider: 'discord',
              providerId: profile.id,
              providerUsername: profile.username,
              providerEmail: profile.email ?? null,
              providerAvatar: discordAvatarUrl,
            },
          });
          const { refreshUserAvatar } = await import('../../utils/avatarSource.js');
          await refreshUserAvatar(record.userId);
          return reply.redirect('/profile?linked=discord');
        }

        // Login flow — find-or-create, set the JWT cookie manually (helpers.signAndSend also
        // writes a JSON body which we'd then clobber with the redirect), and redirect home.
        const displayName = profile.global_name ?? profile.username;
        let resolved;
        try {
          resolved = await helpers.findOrCreateUser({
            provider: 'discord',
            providerId: profile.id,
            providerUsername: profile.username,
            providerEmail: profile.email,
            email: profile.email ?? `${profile.id}@discord.local`,
            displayName,
            avatar: discordAvatarUrl,
          });
        } catch (err) {
          if ((err as Error).message === 'SIGNUP_NOT_ALLOWED') {
            return reply.redirect('/login?error=SIGNUP_NOT_ALLOWED');
          }
          throw err;
        }

        return setAuthCookie(reply, app, resolved)
          .redirect('/');
      }
    );
  },
};

export const discordProvider: Provider = { auth: discordAuth };
