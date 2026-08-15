import type { Availability } from '@oscarr/shared';
import { toMediaStateCategory } from '@oscarr/shared';
import { prisma } from '../utils/prisma.js';
import { mediaKey } from '../utils/mediaKey.js';
import { getServiceDefinition } from '../providers/index.js';

interface MediaRow {
  tmdbId: number;
  mediaType: string;
  statusCategory: string;
  /** Null when no media-server scan has ever seen this title. */
  libraryConfirmedAt?: Date | null;
}
interface RequestRow {
  id: number;
  status: string;
}

/**
 * Which service decides availability, per media type. Holds a service id, not a boolean: the
 * historical behaviour is simply `movie: 'radarr'`, a value like any other rather than a special
 * case bolted on the side.
 */
export interface LibraryGate {
  movie: string;
  tv: string;
}

export const NO_LIBRARY_GATE: LibraryGate = { movie: 'radarr', tv: 'sonarr' };

/**
 * A source needs library confirmation when it is not the *arr that downloaded the file. The *arr
 * already told us it has it — that is what the stored status means — so asking it again would
 * always agree with itself.
 */
export function sourceNeedsLibrary(sourceId: string): boolean {
  const definition = getServiceDefinition(sourceId);
  return definition?.category === 'media-server';
}

/**
 * Downgrade applied at read time, not at write time.
 *
 * The stored status keeps meaning "the *arr has the file" — that fact does not change when the
 * admin flips a setting. Deriving the presented state here means toggling the threshold takes
 * effect instantly, in both directions, with no re-sync and no data migration.
 */
export function gateCategory(
  rawCategory: string,
  mediaType: string,
  libraryConfirmedAt: Date | null | undefined,
  gate: LibraryGate,
): ReturnType<typeof toMediaStateCategory> {
  const category = toMediaStateCategory(rawCategory);
  if (category !== 'AVAILABLE') return category;
  const source = mediaType === 'movie' ? gate.movie : gate.tv;
  if (!sourceNeedsLibrary(source)) return category;
  return libraryConfirmedAt ? 'AVAILABLE' : 'IMPORTED';
}

function applyLibraryGate(
  category: ReturnType<typeof toMediaStateCategory>,
  media: MediaRow,
  gate: LibraryGate,
): ReturnType<typeof toMediaStateCategory> {
  return gateCategory(category, media.mediaType, media.libraryConfirmedAt, gate);
}

/**
 * Prisma `where` fragment hiding unconfirmed titles from "recently added". Empty when no gate is
 * set, so the query is byte-identical to before on a default install.
 */
export async function recentLibraryFilter(): Promise<Record<string, unknown>> {
  const gate = await loadLibraryGate();
  const gated = [
    sourceNeedsLibrary(gate.movie) ? 'movie' : null,
    sourceNeedsLibrary(gate.tv) ? 'tv' : null,
  ].filter(Boolean) as string[];
  if (gated.length === 0) return {};
  return {
    OR: [
      { mediaType: { notIn: gated } },
      { libraryConfirmedAt: { not: null } },
    ],
  };
}

/** Sole builder of the wire Availability object. BLACKLISTED is the only Oscarr-side override. */
export function buildAvailability(
  media: MediaRow,
  userRequest: RequestRow | null,
  blacklistedKeys: ReadonlySet<string>,
  gate: LibraryGate = NO_LIBRARY_GATE,
): Availability {
  const key = mediaKey(media);
  const statusCategory = blacklistedKeys.has(key)
    ? 'BLACKLISTED'
    : applyLibraryGate(toMediaStateCategory(media.statusCategory), media, gate);
  return {
    statusCategory,
    requestStatus: (userRequest?.status as Availability['requestStatus']) ?? null,
    requestId: userRequest?.id ?? null,
  };
}

/** Reads the configured threshold. Defaults to "no gate", i.e. the historical behaviour. */
export async function loadLibraryGate(): Promise<LibraryGate> {
  const { getAppSettings } = await import('../utils/appSettings.js');
  const settings = await getAppSettings();
  return {
    movie: settings?.movieAvailabilitySource || 'radarr',
    tv: settings?.tvAvailabilitySource || 'sonarr',
  };
}

/** Loads blacklisted ${mediaType}:${tmdbId} keys for a list of media in one query. */
export async function loadBlacklistedKeys(
  items: { tmdbId: number; mediaType: string }[],
): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  const rows = await prisma.blacklistedMedia.findMany({
    where: { OR: items.map((i) => ({ tmdbId: i.tmdbId, mediaType: i.mediaType })) },
    select: { tmdbId: true, mediaType: true },
  });
  return new Set(rows.map(mediaKey));
}
