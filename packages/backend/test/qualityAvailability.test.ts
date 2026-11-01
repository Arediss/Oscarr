import { beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/utils/prisma.js';
import { loadFreeQualityMediaIds } from '../src/services/availability.js';

beforeEach(async () => {
  await prisma.mediaRequest.deleteMany();
  await prisma.media.deleteMany();
  await prisma.folderRule.deleteMany();
  await prisma.qualityOption.deleteMany();
  await prisma.service.deleteMany();
});

it('does not offer a quality already satisfied by a recently added title', async () => {
  const service = await prisma.service.create({ data: { name: 'Radarr', type: 'radarr', config: '{}' } });
  const option = await prisma.qualityOption.create({ data: { label: 'HD' } });
  await prisma.qualityMapping.create({ data: { qualityProfileName: 'Test profile', serviceId: service.id, qualityOptionId: option.id, qualityProfileId: 1 } });
  const media = await prisma.media.create({ data: { title: 'Available', tmdbId: 123, mediaType: 'movie', statusCategory: 'AVAILABLE', serviceId: service.id, qualityProfileId: 1 } });
  expect(await loadFreeQualityMediaIds([media.id])).toEqual(new Set());
});

it('does not confuse identical profile numbers on different services', async () => {
  const first = await prisma.service.create({ data: { name: 'Radarr HD', type: 'radarr', config: '{}' } });
  const second = await prisma.service.create({ data: { name: 'Radarr 4K', type: 'radarr', config: '{}' } });
  const option = await prisma.qualityOption.create({ data: { label: '4K' } });
  await prisma.qualityMapping.create({ data: { qualityProfileName: 'Test profile', serviceId: second.id, qualityOptionId: option.id, qualityProfileId: 1 } });
  const media = await prisma.media.create({ data: { title: 'HD only', tmdbId: 123, mediaType: 'movie', statusCategory: 'AVAILABLE', serviceId: first.id, qualityProfileId: 1 } });
  expect(await loadFreeQualityMediaIds([media.id])).toEqual(new Set([media.id]));
});
