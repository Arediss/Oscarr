/** Process-wide maintenance latch.
 *
 *  Held while the database file is being swapped underneath a running server (backup restore):
 *  Prisma is disconnected and `oscarr.db` is replaced, so any request that reached a handler in
 *  that window would query a connection that no longer has a database. The onRequest hook in
 *  `bootstrap/security.ts` answers 503 for the duration instead.
 *
 *  Requests already past that hook when the latch closes are not covered — they fail on the
 *  disconnected client, which is the point: failing loudly beats reading a half-swapped file. */

let reason: string | null = null;

/** Claim the latch. Returns false when someone already holds it — the caller must then abort
 *  rather than proceed, and must NOT call endMaintenance(): the door it would reopen is the
 *  other holder's. Two concurrent restores used to both enter here and race on the same
 *  staging paths. */
export function beginMaintenance(why: string): boolean {
  if (reason !== null) return false;
  reason = why;
  return true;
}

export function endMaintenance(): void {
  reason = null;
}

export function maintenanceReason(): string | null {
  return reason;
}
