import type { RequestStatusKind } from './requestStatus.js';
import type { MediaStateCategory } from './mediaState.js';

/**
 * Status d'un media tel qu'il est écrit dans la DB (`Media.status` Prisma column).
 * - 'unknown' : pas encore tracké
 * - 'upcoming' : sortie future (Radarr.movie.status='announced' / 'rumored')
 * - 'searching' : *arr cherche un release
 * - 'processing' : download en cours (ou partiel pour TV)
 * - 'available' : dispo sur le serveur media (Plex/Jellyfin/Emby)
 * - 'deleted' : retiré (réservé, pas écrit aujourd'hui — voir M7 schema comment)
 */
export const MEDIA_STATUS_VALUES = [
  'unknown',
  'upcoming',
  'searching',
  'processing',
  'available',
  'deleted',
] as const;

export type MediaStatusKind = typeof MEDIA_STATUS_VALUES[number];

/**
 * Shape du objet `availability` retourné sur le wire par GET /api/media,
 * GET /api/media/:id, GET /api/tmdb/*, et batch GET /api/media/status.
 * Combine `Media.status` + `MediaRequest.status` (si une request existe pour
 * ce media + cet utilisateur).
 */
export interface Availability {
  status: MediaStatusKind;
  statusKey?: string;
  statusCategory?: MediaStateCategory;
  requestStatus?: RequestStatusKind | null;
  requestId?: number | null;
  /**
   * Pour les TV partiellement dispos : nombre d'épisodes available vs total.
   * Présent uniquement quand status === 'processing' && mediaType === 'tv'.
   */
  episodes?: { available: number; total: number } | null;
}
