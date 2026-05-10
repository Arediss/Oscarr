import { prisma } from '../utils/prisma.js';

export async function cleanupOrphanedRequests(): Promise<{ deleted: number }> {
  const result = await prisma.$executeRaw`DELETE FROM MediaRequest WHERE userId NOT IN (SELECT id FROM User) OR mediaId NOT IN (SELECT id FROM Media)`;
  return { deleted: result };
}
