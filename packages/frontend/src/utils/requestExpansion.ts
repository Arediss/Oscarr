/** Keep the expanded frame attached to its card, with room for labels near the screen bottom. */
export function positionRequestExpansion(cardTop: number, viewportHeight: number) {
  const margin = 12;
  const top = Math.max(margin, Math.min(cardTop, viewportHeight - margin - 260));
  return { top: top - cardTop, maxHeight: Math.min(480, Math.max(0, viewportHeight - top - margin)) };
}
