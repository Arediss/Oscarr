/**
 * Bidirectional mappings between Oscarr's status strings and Overseerr's numeric status enums.
 * Source: Overseerr `server/constants/media.ts` (MediaStatus, MediaRequestStatus).
 */

// ── MediaRequestStatus (Overseerr) ──
export const SEERR_REQUEST_STATUS = {
  PENDING: 1,
  APPROVED: 2,
  DECLINED: 3,
} as const;

// ── MediaStatus (Overseerr) ──
export const SEERR_MEDIA_STATUS = {
  UNKNOWN: 1,
  PENDING: 2,
  PROCESSING: 3,
  PARTIALLY_AVAILABLE: 4,
  AVAILABLE: 5,
  DELETED: 6,
  BLACKLISTED: 7,
} as const;

/**
 * Oscarr request status enum: "pending" | "approved" | "declined" | "processing" | "available" | "failed"
 * Overseerr only knows pending/approved/declined for the *request* itself; everything past
 * approval (processing, available, failed) is reflected on the linked media row, not the request.
 * So we collapse the post-approval Oscarr states to APPROVED at the request level — Maintainerr
 * & co. then read the actual download/availability state via Media.status.
 */
export function mapRequestStatus(oscarrStatus: string): number {
  if (oscarrStatus === 'pending') return SEERR_REQUEST_STATUS.PENDING;
  if (oscarrStatus === 'declined') return SEERR_REQUEST_STATUS.DECLINED;
  // approved / processing / available / failed → APPROVED for the request itself.
  return SEERR_REQUEST_STATUS.APPROVED;
}

/** Oscarr MediaStateCategory → Overseerr MediaStatus. PROCESSING covers downloading and partial. */
export function mapMediaStatus(category: string | null | undefined): number {
  switch (category) {
    case 'UPCOMING':    return SEERR_MEDIA_STATUS.PENDING;
    case 'SEARCHING':   return SEERR_MEDIA_STATUS.PROCESSING;
    case 'PROCESSING':  return SEERR_MEDIA_STATUS.PROCESSING;
    case 'AVAILABLE':   return SEERR_MEDIA_STATUS.AVAILABLE;
    case 'BLACKLISTED': return SEERR_MEDIA_STATUS.BLACKLISTED;
    default:            return SEERR_MEDIA_STATUS.UNKNOWN; // UNAVAILABLE + unmapped
  }
}

/**
 * Reverse mapping for the `/request?filter=...` query — Overseerr's filter values map back
 * onto Oscarr's `MediaRequest.status` (and sometimes onto the linked Media).
 *
 * Returns either a Prisma `where` fragment for MediaRequest.status, or `null` to mean
 * "no status filter" (i.e. `filter=all` or unsupported value).
 */
export function filterToWhere(filter: string | undefined): { status?: { in: string[] } } | null {
  if (!filter || filter === 'all') return null;
  switch (filter) {
    case 'pending':     return { status: { in: ['pending'] } };
    case 'approved':    return { status: { in: ['approved', 'processing', 'available'] } };
    case 'available':   return { status: { in: ['available'] } };
    case 'processing':  return { status: { in: ['processing'] } };
    case 'unavailable': return { status: { in: ['pending', 'approved', 'processing', 'failed'] } };
    case 'failed':      return { status: { in: ['failed'] } };
    case 'declined':    return { status: { in: ['declined'] } };
    default:            return null;
  }
}
