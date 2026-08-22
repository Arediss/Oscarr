/**
 * Shapes the update-consent diff into the lines the modal actually renders.
 *
 * Capabilities and their reasons arrive as two independent facts. Rendering both lists side by
 * side printed every documented new capability twice — once bare, once explained — which reads as
 * the plugin asking for the same thing twice.
 */

export interface PermissionDiff {
  services: { added: string[]; removed: string[] };
  capabilities: { added: string[]; removed: string[] };
  capabilityReasons: {
    added: Record<string, string>;
    removed: string[];
    changed: { capability: string; from: string; to: string }[];
  };
}

export interface PermLineSpec {
  key: string;
  label: string;
  hint?: string;
  /** True when the capability itself is new, false when only its documentation changed. */
  granted: boolean;
}

export function addedPermissionLines(diff: PermissionDiff): PermLineSpec[] {
  const lines: PermLineSpec[] = diff.services.added.map((s) => ({
    key: `service:${s}`, label: `service:${s}`, granted: true,
  }));

  for (const cap of diff.capabilities.added) {
    lines.push({ key: cap, label: cap, hint: diff.capabilityReasons.added[cap], granted: true });
  }

  // A reason on a capability the plugin already held: newly explained, not newly granted.
  for (const [cap, reason] of Object.entries(diff.capabilityReasons.added)) {
    if (diff.capabilities.added.includes(cap)) continue;
    lines.push({ key: `reason-${cap}`, label: cap, hint: reason, granted: false });
  }

  return lines;
}

export function removedPermissionLines(diff: PermissionDiff): PermLineSpec[] {
  const lines: PermLineSpec[] = diff.services.removed.map((s) => ({
    key: `service:${s}`, label: `service:${s}`, granted: true,
  }));

  for (const cap of diff.capabilities.removed) {
    lines.push({ key: cap, label: cap, granted: true });
  }

  for (const cap of diff.capabilityReasons.removed) {
    if (diff.capabilities.removed.includes(cap)) continue;
    lines.push({ key: `reason-${cap}`, label: cap, granted: false });
  }

  return lines;
}
