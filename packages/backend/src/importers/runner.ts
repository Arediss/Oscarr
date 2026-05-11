import { prisma } from '../utils/prisma.js';
import { findOrCreateMedia } from '../services/requestService.js';
import type {
  AdapterCredentials,
  CanonicalUser,
  ExecuteResult,
  ImportAdapter,
  ImportPreview,
  RequestConflict,
  UserMatch,
} from './types.js';

/** Try to find an existing Oscarr user that matches this canonical user.
 *  Returns the resolved user id + the strategy that succeeded, or null when
 *  no automatic match could be made. */
async function autoMatchUser(u: CanonicalUser): Promise<UserMatch> {
  // 1. Plex / Jellyfin provider id — strongest signal.
  if (u.plexId) {
    const link = await prisma.userProvider.findFirst({
      where: { provider: 'plex', providerId: u.plexId },
      select: { userId: true },
    });
    if (link) return { sourceUser: u, oscarrUserId: link.userId, strategy: 'plex_id' };
  }
  if (u.jellyfinId) {
    const link = await prisma.userProvider.findFirst({
      where: { provider: 'jellyfin', providerId: u.jellyfinId },
      select: { userId: true },
    });
    if (link) return { sourceUser: u, oscarrUserId: link.userId, strategy: 'jellyfin_id' };
  }

  // 2. Email fallback.
  if (u.email) {
    const byEmail = await prisma.user.findUnique({
      where: { email: u.email.toLowerCase() },
      select: { id: true },
    });
    if (byEmail) return { sourceUser: u, oscarrUserId: byEmail.id, strategy: 'email' };
  }

  // 3. No automatic match — admin will decide in the wizard.
  return { sourceUser: u, oscarrUserId: null, strategy: 'manual' };
}

export async function preview(
  adapter: ImportAdapter,
  creds: AdapterCredentials,
): Promise<ImportPreview> {
  await adapter.probe(creds);

  const sourceUsers = await adapter.fetchUsers(creds);
  const sourceRequests = await adapter.fetchRequests(creds);

  const matches = await Promise.all(sourceUsers.map(autoMatchUser));
  const matched = matches.filter((m) => m.oscarrUserId !== null);
  const needsDecision = matches.filter((m) => m.oscarrUserId === null);

  // Build a quick lookup so request-side dedup runs in O(1).
  const matchBySourceId = new Map(matches.map((m) => [m.sourceUser.sourceId, m]));

  const conflicts: RequestConflict[] = [];
  let importable = 0;

  for (const r of sourceRequests) {
    const userMatch = matchBySourceId.get(r.requesterSourceId);
    if (!userMatch || userMatch.oscarrUserId === null) {
      conflicts.push({ sourceRequest: r, reason: 'no_user' });
      continue;
    }
    // Duplicate detection — same (tmdb, mediaType, requester) already on file.
    const existing = await prisma.mediaRequest.findFirst({
      where: {
        userId: userMatch.oscarrUserId,
        media: { tmdbId: r.tmdbId, mediaType: r.mediaType },
      },
      select: { id: true },
    });
    if (existing) {
      conflicts.push({ sourceRequest: r, reason: 'duplicate' });
      continue;
    }
    importable++;
  }

  return {
    source: adapter.source,
    users: { total: sourceUsers.length, matched, needsDecision },
    requests: {
      total: sourceRequests.length,
      importable,
      conflicts,
    },
  };
}

export interface UserDecision {
  sourceId: string;
  /** "link" requires oscarrUserId. "create" makes a new user. "skip" drops
   *  this user and any requests that depend on them. */
  action: 'link' | 'create' | 'skip';
  oscarrUserId?: number;
}

export async function execute(
  adapter: ImportAdapter,
  creds: AdapterCredentials,
  decisions: UserDecision[],
): Promise<ExecuteResult> {
  const sourceUsers = await adapter.fetchUsers(creds);
  const sourceRequests = await adapter.fetchRequests(creds);

  const decisionBySourceId = new Map(decisions.map((d) => [d.sourceId, d]));
  const resolved = new Map<string, number>();
  let usersCreated = 0;
  let usersLinked = 0;

  // Resolve every source user up front so request creation is just a
  // lookup. Auto-match anything the wizard didn't override.
  for (const u of sourceUsers) {
    const decision = decisionBySourceId.get(u.sourceId);
    if (decision?.action === 'skip') continue;

    if (decision?.action === 'link' && decision.oscarrUserId) {
      resolved.set(u.sourceId, decision.oscarrUserId);
      usersLinked++;
      continue;
    }

    if (decision?.action === 'create') {
      const created = await createOscarrUser(u);
      resolved.set(u.sourceId, created);
      usersCreated++;
      continue;
    }

    // No explicit decision — fall back to auto-match (re-runs the cascade).
    const match = await autoMatchUser(u);
    if (match.oscarrUserId) {
      resolved.set(u.sourceId, match.oscarrUserId);
      usersLinked++;
    }
  }

  let requestsCreated = 0;
  let requestsSkipped = 0;

  for (const r of sourceRequests) {
    const userId = resolved.get(r.requesterSourceId);
    if (!userId) {
      requestsSkipped++;
      continue;
    }

    let media;
    try {
      media = await findOrCreateMedia(r.tmdbId, r.mediaType);
    } catch {
      requestsSkipped++;
      continue;
    }

    const dup = await prisma.mediaRequest.findFirst({
      where: { userId, mediaId: media.id },
      select: { id: true },
    });
    if (dup) {
      requestsSkipped++;
      continue;
    }

    await prisma.mediaRequest.create({
      data: {
        userId,
        mediaId: media.id,
        mediaType: r.mediaType,
        status: r.status === 'available' ? 'available' : r.status,
        seasons: r.seasons?.length ? JSON.stringify(r.seasons) : null,
        createdAt: r.createdAt,
      },
    });
    requestsCreated++;
  }

  return { usersCreated, usersLinked, requestsCreated, requestsSkipped };
}

/** Create a fresh Oscarr user from a canonical record + mirror provider links
 *  so future logins (Plex/Jellyfin OAuth) attach to the same row. */
async function createOscarrUser(u: CanonicalUser): Promise<number> {
  const email = u.email?.toLowerCase()
    ?? `imported-${u.sourceId}@oscarr.local`; // synthetic email keeps email UNIQUE happy

  const created = await prisma.user.create({
    data: {
      email,
      displayName: u.displayName,
      role: 'user', // never auto-promote to admin during import
      providers: {
        create: [
          ...(u.plexId
            ? [{ provider: 'plex', providerId: u.plexId }]
            : []),
          ...(u.jellyfinId
            ? [{ provider: 'jellyfin', providerId: u.jellyfinId }]
            : []),
        ],
      },
    },
    select: { id: true },
  });
  return created.id;
}
