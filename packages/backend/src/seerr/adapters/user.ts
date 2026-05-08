import type { User, UserProvider } from '@prisma/client';

/**
 * Overseerr Permission bit flags. We only emit the few bits Seerr clients actually gate
 * features on (mostly ADMIN); the rest stay 0 because Oscarr's permission model is role-based,
 * not per-flag.
 *
 * Source: github.com/sct/overseerr/src/server/lib/permissions.ts
 */
const SEERR_PERMISSION = {
  NONE: 0,
  ADMIN: 2,
  MANAGE_REQUESTS: 16,
  REQUEST: 32,
  AUTO_APPROVE: 256,
} as const;

/**
 * Overseerr `userType`:
 *   1 = Plex (federated)
 *   2 = Local (email/password)
 * We map Oscarr's primary linked provider — falling back to LOCAL when the user signed up via
 * email or has no provider link, since clients otherwise refuse to render the avatar/menu.
 */
const SEERR_USER_TYPE = { PLEX: 1, LOCAL: 2 } as const;

export interface SeerrUser {
  id: number;
  email: string;
  plexUsername: string | null;
  username: string | null;
  recoveryLinkExpirationDate: string | null;
  userType: number;
  permissions: number;
  avatar: string;
  movieQuotaLimit: number | null;
  movieQuotaDays: number | null;
  tvQuotaLimit: number | null;
  tvQuotaDays: number | null;
  createdAt: string;
  updatedAt: string;
  requestCount: number;
  displayName: string;
}

export interface AdaptUserInput {
  user: User & { providers: UserProvider[] };
  requestCount: number;
}

export function buildSeerrUser({ user, requestCount }: AdaptUserInput): SeerrUser {
  const isAdmin = user.role === 'admin';
  const plexLink = user.providers.find((p) => p.provider === 'plex');
  const userType = plexLink ? SEERR_USER_TYPE.PLEX : SEERR_USER_TYPE.LOCAL;

  // Admin gets ADMIN | MANAGE_REQUESTS | REQUEST | AUTO_APPROVE; non-admin gets REQUEST only.
  // Oscarr's per-role permission system is more granular but most third-party clients only
  // branch on ADMIN vs not, so this approximation is close enough for v0.9.0.
  const permissions = isAdmin
    ? SEERR_PERMISSION.ADMIN | SEERR_PERMISSION.MANAGE_REQUESTS | SEERR_PERMISSION.REQUEST | SEERR_PERMISSION.AUTO_APPROVE
    : SEERR_PERMISSION.REQUEST;

  return {
    id: user.id,
    email: user.email,
    plexUsername: plexLink?.providerUsername ?? null,
    username: user.displayName,
    recoveryLinkExpirationDate: null,
    userType,
    permissions,
    avatar: user.avatar ?? '',
    // Oscarr quotas live in the optional `plugin-quotas` plugin — we report no limit here so
    // clients don't pre-emptively block requests. The plugin will own its own enforcement.
    movieQuotaLimit: null,
    movieQuotaDays: null,
    tvQuotaLimit: null,
    tvQuotaDays: null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    requestCount,
    displayName: user.displayName ?? user.email,
  };
}
