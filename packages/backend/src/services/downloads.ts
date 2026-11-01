import { getAllServices } from '../utils/services.js';
import { getArrClientForService } from '../providers/index.js';
import { prisma } from '../utils/prisma.js';

interface QueueRecord {
  title: string; status: string; size: number; sizeleft: number; timeleft: string; estimatedCompletionTime: string;
  movie?: { tmdbId?: number };
  series?: { tvdbId?: number; seasonType?: string };
  episode?: { seasonNumber: number; episodeNumber: number; title: string };
}

/** Queue numbers are scoped to the actual instance, just like its metadata catalogue. */
export async function getDownloads() {
  const groups = await Promise.all([getAllServices('radarr'), getAllServices('sonarr')]);
  const queues = await Promise.all(groups.flat().map(async service => {
    try {
      const queue = await getArrClientForService(service.id, service.type, service.config).getQueue();
      return { service, records: queue.records as QueueRecord[] };
    } catch { return { service, records: [] as QueueRecord[] }; }
  }));
  const tvdbIds = [...new Set(queues.flatMap(queue => queue.records.map(item => item.series?.tvdbId).filter((id): id is number => Number.isSafeInteger(id) && id! > 0)))];
  const media = tvdbIds.length ? await prisma.media.findMany({ where: { mediaType: 'tv', tvdbId: { in: tvdbIds }, tmdbId: { gt: 0 } }, select: { tvdbId: true, tmdbId: true } }) : [];
  const tmdbIds = new Map(media.map(item => [item.tvdbId, item.tmdbId]));
  return queues.flatMap(({ service, records }) => records.flatMap(item => {
    const isTv = service.type === 'sonarr';
    const tmdbId = isTv ? tmdbIds.get(item.series?.tvdbId ?? 0) : item.movie?.tmdbId;
    if (!Number.isSafeInteger(tmdbId) || tmdbId! <= 0) return [];
    const numbering = item.series?.seasonType ?? 'official';
    return [{
      tmdbId: tmdbId!, mediaType: isTv ? 'tv' : 'movie', serviceId: service.id,
      seasonNumbering: isTv && /^[a-zA-Z0-9_-]{1,40}$/.test(numbering) ? `tvdb:${numbering}` : undefined,
      title: item.title, status: item.status, size: item.size, sizeLeft: item.sizeleft,
      progress: item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0,
      timeLeft: item.timeleft, estimatedCompletion: item.estimatedCompletionTime,
      episode: isTv && item.episode ? { seasonNumber: item.episode.seasonNumber, episodeNumber: item.episode.episodeNumber, title: item.episode.title } : undefined,
    }];
  }));
}
