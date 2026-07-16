import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../utils/prisma.js';
import { getAppSettings } from '../../utils/appSettings.js';
import { getPlexUser, createPlexPin, checkPlexPin, getSharedServerUsers } from './client.js';
import { logEvent } from '../../utils/logEvent.js';
import { parseServiceConfig } from '../../utils/services.js';
import type { Provider, AuthProvider } from '../types.js';
import { isProviderEnabled } from '../authSettings.js';
import { refreshUserAvatar } from '../../utils/avatarSource.js';
import { resolvePublicBaseUrl } from '../../utils/publicUrl.js';

const PLEX_CLIENT_ID = 'oscarr-client';

// ─── Exported utilities for setup routes ────────────────────────────

export async function plexCreatePin(forwardUrlBase?: string, state?: string) {
  const pin = await createPlexPin(PLEX_CLIENT_ID);
  let authUrl = `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_ID}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=Oscarr`;
  if (forwardUrlBase) {
    // Plex forwards the auth tab back here after sign-in instead of leaving the user on its static
    // "you can now close this window" page — critical on mobile, where the original Oscarr tab is
    // backgrounded/suspended and can't poll the PIN to close the auth tab itself (#212). `state`
    // binds the returned pin to the session that started the login (CSRF / session-fixation guard).
    const sep = forwardUrlBase.includes('?') ? '&' : '?';
    let forwardUrl = `${forwardUrlBase}${sep}pinId=${pin.id}`;
    if (state) forwardUrl += `&state=${encodeURIComponent(state)}`;
    authUrl += `&forwardUrl=${encodeURIComponent(forwardUrl)}`;
  }
  return { pin, authUrl };
}

export async function plexCheckPin(pinId: number): Promise<string | null> {
  return checkPlexPin(pinId, PLEX_CLIENT_ID);
}

/** Probe a Plex server's /identity endpoint from the backend. Called by setup + admin routes
 *  to spare the browser from fetching the LAN Plex URL directly, which CSP connect-src 'self'
 *  blocks in production. Returns just the machineIdentifier — callers don't need the rest. */
export async function plexFetchMachineId(url: string, token: string): Promise<string | null> {
  const trimmedUrl = url.replace(/\/$/, '');
  const { data } = await axios.get(`${trimmedUrl}/identity`, {
    headers: { 'X-Plex-Token': token, Accept: 'application/json' },
    timeout: 5000,
  });
  return (data as { MediaContainer?: { machineIdentifier?: string } }).MediaContainer?.machineIdentifier ?? null;
}

export async function getPlexToken(adminUserId?: number): Promise<string | null> {
  const plexService = await prisma.service.findFirst({
    where: { type: 'plex', enabled: true },
  });
  const config = plexService ? parseServiceConfig(plexService.config) : null;
  if (config?.token) return config.token;

  if (adminUserId) {
    const provider = await prisma.userProvider.findUnique({
      where: { userId_provider: { userId: adminUserId, provider: 'plex' } },
    });
    if (provider?.providerToken) return provider.providerToken;
  }
  return null;
}

async function importPlexUsers(plexToken: string, machineId: string, filter?: { providerIds?: string[] }) {
  const allShared = await getSharedServerUsers(plexToken, machineId);
  const allowed = filter?.providerIds ? new Set(filter.providerIds) : null;
  const sharedUsers = allowed ? allShared.filter((u) => allowed.has(String(u.id))) : allShared;
  let imported = 0;
  let skipped = 0;

  for (const user of sharedUsers) {
    const existingProvider = user.id ? await prisma.userProvider.findUnique({
      where: { provider_providerId: { provider: 'plex', providerId: String(user.id) } },
    }) : null;
    const existingUser = existingProvider || (user.email ? await prisma.user.findUnique({
      where: { email: user.email.toLowerCase() },
    }) : null);

    if (existingUser) { skipped++; continue; }

    await prisma.user.create({
      data: {
        email: (user.email || `${user.username}@plex.local`).toLowerCase(),
        displayName: user.username || user.title,
        avatar: user.thumb,
        role: 'user',
        providers: {
          create: {
            provider: 'plex',
            providerId: String(user.id),
            providerUsername: user.username || user.title,
          },
        },
      },
    });
    imported++;
  }

  logEvent('info', 'User', `Plex import: ${imported} imported, ${skipped} already existed`);
  return { imported, skipped, total: sharedUsers.length };
}

// ─── Auth Provider ──────────────────────────────────────────────────

const plexAuth: AuthProvider = {
  config: {
    id: 'plex',
    label: 'Plex',
    type: 'oauth',
    configSchema: [
      {
        key: 'allowSignup',
        label: 'Allow new account creation',
        type: 'boolean',
        default: false,
        help: 'Auto-create Oscarr users for new Plex logins.',
      },
    ],
  },

  async registerRoutes(app, helpers) {
    app.post('/plex/pin', {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      if (!(await isProviderEnabled('plex'))) {
        return reply.status(403).send({ error: 'PROVIDER_DISABLED' });
      }
      // forwardUrl lands the auth tab on the Oscarr /plex-return page (which finalizes the LOGIN
      // session) after Plex sign-in — for the login flow ONLY (#212). This same endpoint is reused
      // by the admin "link Plex account" flow (UsersTab), which must NOT forward there or it would
      // run the login callback and hijack the admin's session — so forwarding is opt-in.
      const forward = (request.body as { forward?: boolean } | undefined)?.forward === true;
      // Bind the pin to THIS browser session so a crafted /plex-return?pinId=... can't log a victim
      // into an attacker's account (login CSRF / session fixation). Both the desktop poll and the
      // forwarded /plex-return echo `state`; the callback requires it to match this HttpOnly cookie.
      let state: string | undefined;
      if (forward) {
        state = randomUUID();
        reply.setCookie('oscarr_plex_state', state, {
          path: '/',
          httpOnly: true,
          secure: process.env.COOKIE_SECURE === 'true'
            || (process.env.COOKIE_SECURE !== 'false' && request.protocol === 'https'),
          sameSite: 'lax',
          maxAge: 600, // 10 min — comfortably covers the 2-min PIN TTL
        });
      }
      const result = await plexCreatePin(forward ? `${resolvePublicBaseUrl(request)}/plex-return` : undefined, state);
      return reply.send({ ...result, state });
    });

    app.post('/plex/callback', {
      // Frontend pinFlow polls 1/s for up to 2 min (PIN TTL) — bump the limit so 2FA delays
      // don't trip the rate limiter and abort the login mid-flow. The endpoint is naturally
      // bounded by the PIN lifetime; the limit is a flood guard, not a per-request budget.
      config: { rateLimit: { max: 150, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object' as const,
          required: ['pinId', 'state'],
          properties: {
            pinId: { type: 'number' as const, description: 'Plex PIN ID returned by /plex/pin' },
            state: { type: 'string' as const, description: 'Session-binding token from /plex/pin' },
          },
        },
      },
    }, async (request, reply) => {
      if (!(await isProviderEnabled('plex'))) {
        return reply.status(403).send({ error: 'PROVIDER_DISABLED' });
      }
      const { pinId, state } = request.body as { pinId: unknown; state: unknown };
      if (typeof pinId !== 'number' || !Number.isFinite(pinId) || pinId < 1) {
        return reply.status(400).send({ error: 'Invalid pinId' });
      }
      // Session-fixation guard: the pin must belong to the session that started THIS login. A
      // crafted /plex-return?pinId=... with an attacker's pin has no matching cookie → rejected.
      const stateCookie = request.cookies?.oscarr_plex_state;
      if (typeof state !== 'string' || !state || !stateCookie || state !== stateCookie) {
        return reply.status(403).send({ error: 'INVALID_STATE' });
      }

      const authToken = await checkPlexPin(pinId, PLEX_CLIENT_ID);
      if (!authToken) {
        logEvent('warn', 'Auth', `PIN validation failed (pinId: ${pinId})`);
        return reply.status(400).send({ error: 'PIN not validated. Try again.' });
      }
      // The state cookie is intentionally NOT cleared here: on desktop the opener's poll and the
      // forwarded popup both hit this endpoint, and clearing would 403 whichever loses the race —
      // a spurious "login expired" despite a valid session. It's a random HttpOnly token an attacker
      // can neither read nor set, and it self-expires via its 10-min maxAge, so leaving it keeps the
      // double-submit idempotent without weakening the guard.

      const plexAccount = await getPlexUser(authToken);
      let result;
      try {
        result = await helpers.findOrCreateUser({
          provider: 'plex',
          providerId: String(plexAccount.id),
          providerToken: authToken,
          providerUsername: plexAccount.username,
          providerEmail: plexAccount.email.toLowerCase(),
          email: plexAccount.email.toLowerCase(),
          displayName: plexAccount.username,
          avatar: plexAccount.thumb,
        });
      } catch (err) {
        if ((err as Error).message === 'SIGNUP_NOT_ALLOWED') {
          return reply.status(403).send({ error: 'SIGNUP_NOT_ALLOWED' });
        }
        throw err;
      }

      logEvent('info', 'Auth', `${result.displayName} logged in (plex)${result.isNew ? ' — new account' : ''}`);
      return helpers.signAndSend(reply, result.id);
    });
  },

  async linkAccount(pinId, userId) {
    const authToken = await checkPlexPin(pinId, PLEX_CLIENT_ID);
    if (!authToken) throw new Error('PIN_INVALID');

    const plexAccount = await getPlexUser(authToken);
    const existing = await prisma.userProvider.findUnique({
      where: { provider_providerId: { provider: 'plex', providerId: String(plexAccount.id) } },
    });
    if (existing && existing.userId !== userId) throw new Error('PROVIDER_ALREADY_LINKED');

    await prisma.userProvider.upsert({
      where: { userId_provider: { userId, provider: 'plex' } },
      update: { providerId: String(plexAccount.id), providerToken: authToken, providerUsername: plexAccount.username, providerEmail: plexAccount.email.toLowerCase(), providerAvatar: plexAccount.thumb ?? null },
      create: { userId, provider: 'plex', providerId: String(plexAccount.id), providerToken: authToken, providerUsername: plexAccount.username, providerEmail: plexAccount.email.toLowerCase(), providerAvatar: plexAccount.thumb ?? null },
    });

    await refreshUserAvatar(userId);
    logEvent('info', 'Auth', `Plex account linked: ${plexAccount.username}`);
    return { providerUsername: plexAccount.username };
  },

  async getToken(adminUserId) {
    return getPlexToken(adminUserId);
  },

  async importUsers(adminUserId, filter) {
    const token = await getPlexToken(adminUserId);
    if (!token) throw new Error('NO_TOKEN');
    const machineId = await resolveMachineId();
    if (!machineId) throw new Error('NO_MACHINE_ID');
    return importPlexUsers(token, machineId, filter);
  },

  async syncUsers(adminUserId) {
    const token = await getPlexToken(adminUserId);
    if (!token) throw new Error('NO_TOKEN');
    const machineId = await resolveMachineId();
    if (!machineId) throw new Error('NO_MACHINE_ID');
    const { syncPlexUsers } = await import('./sync.js');
    return syncPlexUsers(token, machineId, adminUserId);
  },
};

async function resolveMachineId(): Promise<string | null> {
  const settings = await getAppSettings();
  if (settings?.plexMachineId) return settings.plexMachineId;
  const plexService = await prisma.service.findFirst({ where: { type: 'plex', enabled: true } });
  if (plexService) {
    try {
      const cfg = parseServiceConfig(plexService.config);
      return cfg.machineId || null;
    } catch { /* ignore */ }
  }
  return null;
}

// ─── Unified Provider ───────────────────────────────────────────────

export const plexProvider: Provider = {
  service: {
    id: 'plex',
    label: 'Plex',
    icon: '/providers/plex.svg',
    category: 'media-server',
    requiredForInstall: true,
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:32400' },
      { key: 'token', labelKey: 'common.token', type: 'password', helper: 'plex-oauth' },
      { key: 'machineId', labelKey: 'provider.plex.machine_id', type: 'text', helper: 'plex-detect-machine-id' },
    ],
    async test(config) {
      const { data } = await axios.get(`${config.url}/identity`, {
        headers: { 'X-Plex-Token': config.token, Accept: 'application/json' },
        timeout: 5000,
      });
      return { ok: true, version: data.MediaContainer?.version };
    },
  },
  auth: plexAuth,
};
