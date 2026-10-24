import { prisma } from '../utils/prisma.js';
import { release010 } from '../releases/release010.js';

/** Release content is data, not a schema migration. Safe for new and existing installs. */
export async function seedReleaseNotes(): Promise<void> {
  await prisma.patchnote.upsert({
    where: { version: release010.version },
    create: release010,
    update: release010,
  });
}
