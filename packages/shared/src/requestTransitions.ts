// app/packages/shared/src/requestTransitions.ts

import { type RequestStatusKind } from './requestStatus.js';

/**
 * Table des transitions légitimes de `MediaRequest.status`.
 * Lecture: depuis l'état `from`, on peut aller vers n'importe quel `to` listé.
 *
 * Établi à partir de l'audit 2026-05-24 + REQUEST_STATUSES + les 3 sets dérivés
 * (ACTIVE/COMPLETABLE/RETRYABLE). À durcir vers un throw quand on aura assez
 * de logs prod pour être sûr du catalogue complet.
 *
 * Légende des transitions notables :
 * - `pending → failed` : si approve + dispatch *arr sont atomiques et le dispatch échoue
 * - `approved → available` : cascade quand le media devient available avant que processing soit écrit
 * - `failed → approved` : admin re-approuve manuellement
 * - `failed → processing` : scheduler retry job re-dispatche
 * - `failed → available` : cascade via promoteStaleStatuses
 */
const VALID_TRANSITIONS: Record<RequestStatusKind, ReadonlyArray<RequestStatusKind>> = {
  pending: ['approved', 'declined', 'failed'],
  approved: ['processing', 'failed', 'available'],
  processing: ['available', 'failed'],
  failed: ['approved', 'processing', 'available'],
  declined: [], // terminal
  available: [], // terminal
};

/**
 * Pure check — renvoie true si la transition `from → to` est dans la table.
 * Caller decides what to do si false (typiquement: console.warn + procéder).
 *
 * Cas particuliers :
 * - `from === to` : toujours valide (no-op write, fréquent dans retry idempotents)
 * - `from === undefined` (création) : toujours valide
 */
export function isValidTransition(
  from: RequestStatusKind | null | undefined,
  to: RequestStatusKind,
): boolean {
  if (from == null) return true;
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Pour logs/debug uniquement — retourne la liste des transitions valides
 * depuis `from`. Sert au formattage du warn-log côté backend.
 */
export function validTransitionsFrom(from: RequestStatusKind): readonly RequestStatusKind[] {
  return VALID_TRANSITIONS[from] ?? [];
}
