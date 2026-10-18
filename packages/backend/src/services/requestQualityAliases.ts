import { prisma } from '../utils/prisma.js';

interface Destination {
  targetService: { id: number } | null;
  targetProfileId: number | null;
  defaultProfileId: number | null;
  defaultFolder: string | null | undefined;
  ruleMatch: { folderPath: string } | null;
}

/** Labels are aliases when dispatch would choose the same service, profile and folder.
 * Unknown destinations stay distinct; no guess based on a profile number from another service. */
export async function requestQualityAliases(
  selected: number | undefined,
  resolve: (option: number | undefined) => Promise<Destination>,
  rootFolder?: string,
): Promise<(number | null)[]> {
  const options = await prisma.qualityOption.findMany({ select: { id: true } });
  const aliases: (number | null)[] = [selected ?? null];
  if (options.length === 0) return aliases;
  const key = (destination: Destination): string | null => {
    const profile = destination.targetProfileId ?? destination.defaultProfileId;
    if (!destination.targetService || profile == null) return null;
    return JSON.stringify([destination.targetService.id, profile, rootFolder || destination.ruleMatch?.folderPath || destination.defaultFolder || null]);
  };
  const selectedKey = key(await resolve(selected));
  if (selectedKey === null) return aliases;
  for (const id of [null, ...options.map(option => option.id)]) {
    if (id === (selected ?? null)) continue;
    if (key(await resolve(id ?? undefined)) === selectedKey) aliases.push(id);
  }
  return aliases;
}
