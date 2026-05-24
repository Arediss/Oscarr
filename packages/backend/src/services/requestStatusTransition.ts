import type { RequestStatusKind } from '@oscarr/shared';
import { isValidTransition, validTransitionsFrom } from '@oscarr/shared';

interface FastifyLogger {
  warn(obj: object, msg: string): void;
}

/**
 * Wrap a write of `MediaRequest.status` to log unusual transitions.
 * Warn-only: we proceed regardless of validity. The catalogue in
 * `@oscarr/shared/requestTransitions.ts` is best-effort and will be
 * tightened once we have prod log signal.
 *
 * When the writer has no read of the current row (`updateMany`, `create`),
 * pass `from: undefined` — the helper treats it as "creation" and skips the warn.
 */
export async function transitionRequestStatus<T>(
  ctx: {
    requestId: number | undefined;
    from: RequestStatusKind | null | undefined;
    to: RequestStatusKind;
    why: string;
  },
  write: () => Promise<T>,
  logger?: FastifyLogger,
): Promise<T> {
  if (!isValidTransition(ctx.from, ctx.to)) {
    const payload = {
      requestId: ctx.requestId,
      from: ctx.from,
      to: ctx.to,
      why: ctx.why,
      validNexts: ctx.from ? validTransitionsFrom(ctx.from).join(', ') : '<from=null>',
    };
    if (logger) {
      logger.warn(payload, 'Unusual MediaRequest.status transition');
    } else {
      console.warn('[transitionRequestStatus] Unusual transition:', payload);
    }
  }
  return write();
}
