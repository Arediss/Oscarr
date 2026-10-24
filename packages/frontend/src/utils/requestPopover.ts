export function positionRequestPopover(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
) {
  const margin = 12;
  const gap = 8;
  const width = Math.min(Math.max(anchor.width, 320), viewport.width - margin * 2);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - width - margin));
  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  if (Math.max(below, above) < 120) {
    return { left, width, top: margin, maxHeight: Math.max(0, viewport.height - margin * 2) };
  }
  if (below >= 240 || below >= above) {
    return { left, width, top: anchor.bottom + gap, maxHeight: Math.min(420, below) };
  }
  return { left, width, bottom: viewport.height - anchor.top + gap, maxHeight: Math.min(420, above) };
}
