import { prisma } from '../utils/prisma.js';
import type { ServiceContext } from './requestRouting.js';

interface RequestVariant {
  qualityOptionId?: number | null;
  rootFolder?: string | null;
}

function destinationKey(destination: ServiceContext, rootFolder: string | null | undefined): string | null {
  const profile = destination.targetProfileId ?? destination.defaultProfileId;
  if (!destination.targetService || profile == null) return null;
  return JSON.stringify([
    destination.targetService.id, profile,
    rootFolder || destination.ruleMatch?.folderPath || destination.defaultFolder || null,
    [...new Set(destination.ruleMatch?.tagIds ?? [])].sort((a, b) => a - b),
    destination.ruleMatch?.seriesType || 'standard',
  ]);
}

/** Resolve quality aliases before the write transaction, then compare each candidate's own
 * folder and routed actions. Unavailable metadata must not prevent a pending request:
 * without a known destination, only identical explicit options/folders are duplicates. */
export async function createRequestVariantMatcher(
  selected: RequestVariant,
  resolve: (option: number | undefined) => Promise<ServiceContext>,
): Promise<(candidate: RequestVariant) => boolean> {
  const sameExplicitVariant = (candidate: RequestVariant) =>
    (candidate.qualityOptionId ?? null) === (selected.qualityOptionId ?? null)
    && (candidate.rootFolder || null) === (selected.rootFolder || null);
  const options = await prisma.qualityOption.findMany({ select: { id: true } });
  if (options.length === 0) return sameExplicitVariant;

  let selectedDestination: ServiceContext;
  try {
    selectedDestination = await resolve(selected.qualityOptionId ?? undefined);
  } catch {
    return sameExplicitVariant;
  }
  const selectedKey = destinationKey(selectedDestination, selected.rootFolder);
  if (selectedKey === null) return sameExplicitVariant;

  const destinations = new Map<number | null, ServiceContext>([
    [selected.qualityOptionId ?? null, selectedDestination],
  ]);
  for (const id of [null, ...options.map(option => option.id)]) {
    if (destinations.has(id)) continue;
    try {
      destinations.set(id, await resolve(id ?? undefined));
    } catch {
      // A failed lookup cannot establish equivalence with another quality option.
    }
  }
  return candidate => {
    const destination = destinations.get(candidate.qualityOptionId ?? null);
    const key = destination && destinationKey(destination, candidate.rootFolder);
    return key == null ? sameExplicitVariant(candidate) : key === selectedKey;
  };
}
