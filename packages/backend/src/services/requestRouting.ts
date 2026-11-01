import { prisma } from '../utils/prisma.js';
import { getAppSettings } from '../utils/appSettings.js';
import { getServiceTypeForMedia } from '../providers/index.js';
import { getMovieDetails, getTvDetails } from './tmdb.js';
import { matchFolderRule } from './folderRules.js';
import { getServiceById, getAllServices } from '../utils/services.js';

export interface ServiceContext {
  targetService: { id: number; config: Record<string, string> } | null;
  targetProfileId: number | null;
  defaultProfileId: number | null;
  defaultFolder: string | null | undefined;
  ruleMatch: Awaited<ReturnType<typeof matchFolderRule>>;
}

export async function resolveServiceContext(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  userId: number | null,
  qualityOptionId?: number,
  criterionValueIds: number[] = [],
): Promise<ServiceContext> {
  const settings = await getAppSettings();
  const defaultProfileId = settings?.defaultQualityProfile ?? null;

  const tmdbData = mediaType === 'movie'
    ? await getMovieDetails(tmdbId)
    : await getTvDetails(tmdbId);

  const ruleMatch = await matchFolderRule(mediaType, tmdbData, userId, qualityOptionId, criterionValueIds);
  const defaultFolder = mediaType === 'movie' ? settings?.defaultMovieFolder : settings?.defaultTvFolder;

  let targetServiceId: number | null = ruleMatch?.serviceId ?? null;
  let targetProfileId: number | null = null;

  if (qualityOptionId) {
    const serviceType = getServiceTypeForMedia(mediaType);
    const mapping = await prisma.qualityMapping.findFirst({
      where: {
        qualityOptionId,
        // When a folder rule matched a service, look up the quality mapping on THAT service;
        // otherwise (serviceId undefined = ignored) fall back to the first enabled service. The
        // enabled/type filter stays on both branches so a matched-but-disabled service yields no
        // mapping and falls back to the default profile, instead of applying a profile id that is
        // only valid on another instance.
        serviceId: targetServiceId ?? undefined,
        service: { type: serviceType, enabled: true },
      },
      include: { service: true },
    });
    if (mapping) {
      targetServiceId = mapping.serviceId;
      targetProfileId = mapping.qualityProfileId;
    }
  }

  let targetService: { id: number; config: Record<string, string> } | null = null;
  if (targetServiceId) {
    targetService = await getServiceById(targetServiceId) as { id: number; config: Record<string, string> } | null;
  }
  if (!targetService) {
    const services = await getAllServices(getServiceTypeForMedia(mediaType));
    if (services.length > 0) targetService = services[0];
  }

  return { targetService, targetProfileId, defaultProfileId, defaultFolder, ruleMatch };
}
