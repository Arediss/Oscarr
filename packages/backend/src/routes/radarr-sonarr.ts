import type { FastifyInstance } from 'fastify';
import { getArrClient } from '../providers/index.js';
import { prisma } from '../utils/prisma.js';
import { logEvent } from '../utils/logEvent.js';

export async function radarrSonarrRoutes(app: FastifyInstance) {
  // Radarr status
  app.get('/radarr/status', async (_request, reply) => {
    try {
      const radarr = await getArrClient('radarr');
      const status = await radarr.getSystemStatus();
      return { online: true, version: status.version };
    } catch {
      return reply.send({ online: false });
    }
  });

  // Sonarr status
  app.get('/sonarr/status', async (_request, reply) => {
    try {
      const sonarr = await getArrClient('sonarr');
      const status = await sonarr.getSystemStatus();
      return { online: true, version: status.version };
    } catch {
      return reply.send({ online: false });
    }
  });

  // Radarr queue (download status)
  app.get('/radarr/queue', async () => {
    const radarr = await getArrClient('radarr');
    const queue = await radarr.getQueue();
    return queue.records.map(raw => {
      const item = raw as { movieId: number; title: string; status: string; size: number; sizeleft: number; timeleft: string; estimatedCompletionTime: string };
      return {
        movieId: item.movieId,
        title: item.title,
        status: item.status,
        size: item.size,
        sizeLeft: item.sizeleft,
        timeLeft: item.timeleft,
        estimatedCompletion: item.estimatedCompletionTime,
        progress: item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0,
      };
    });
  });

  // Sonarr queue (download status)
  app.get('/sonarr/queue', async () => {
    const sonarr = await getArrClient('sonarr');
    const queue = await sonarr.getQueue();
    return queue.records.map(raw => {
      const item = raw as { seriesId: number; title: string; status: string; size: number; sizeleft: number; timeleft: string; estimatedCompletionTime: string; episode?: { seasonNumber: number; episodeNumber: number; title: string } };
      return {
        seriesId: item.seriesId,
        title: item.title,
        status: item.status,
        size: item.size,
        sizeLeft: item.sizeleft,
        timeLeft: item.timeleft,
        estimatedCompletion: item.estimatedCompletionTime,
        progress: item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0,
        episode: item.episode,
      };
    });
  });

  // Combined download queue mapped to tmdbId
  app.get('/downloads', async () => {
    try {
      const [radarr, sonarr] = await Promise.all([
        getArrClient('radarr'),
        getArrClient('sonarr'),
      ]);
      const [radarrQueue, sonarrQueue] = await Promise.all([
        radarr.getQueue().catch(() => ({ records: [] as unknown[] })),
        sonarr.getQueue().catch(() => ({ records: [] as unknown[] })),
      ]);

      const downloads: {
        tmdbId: number; mediaType: string; title: string;
        progress: number; timeLeft: string; estimatedCompletion: string;
        size: number; sizeLeft: number; status: string;
        episode?: { seasonNumber: number; episodeNumber: number; title: string };
      }[] = [];

      for (const raw of radarrQueue.records) {
        const item = raw as { title: string; status: string; size: number; sizeleft: number; timeleft: string; estimatedCompletionTime: string; movie?: { tmdbId?: number } };
        if (!item.movie?.tmdbId) continue;
        downloads.push({
          tmdbId: item.movie.tmdbId,
          mediaType: 'movie',
          title: item.title,
          progress: item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0,
          timeLeft: item.timeleft,
          estimatedCompletion: item.estimatedCompletionTime,
          size: item.size,
          sizeLeft: item.sizeleft,
          status: item.status,
        });
      }

      for (const raw of sonarrQueue.records) {
        const item = raw as { title: string; status: string; size: number; sizeleft: number; timeleft: string; estimatedCompletionTime: string; series?: { tvdbId?: number }; episode?: { seasonNumber: number; episodeNumber: number; title: string } };
        if (!item.series?.tvdbId) continue;
        // Look up tmdbId from our DB via tvdbId
        const media = await prisma.media.findFirst({ where: { tvdbId: item.series.tvdbId, mediaType: 'tv' }, select: { tmdbId: true } });
        if (!media) continue;
        downloads.push({
          tmdbId: media.tmdbId,
          mediaType: 'tv',
          title: item.title,
          progress: item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0,
          timeLeft: item.timeleft,
          estimatedCompletion: item.estimatedCompletionTime,
          size: item.size,
          sizeLeft: item.sizeleft,
          status: item.status,
          episode: item.episode ? { seasonNumber: item.episode.seasonNumber, episodeNumber: item.episode.episodeNumber, title: item.episode.title } : undefined,
        });
      }

      return downloads;
    } catch (err) {
      logEvent('debug', 'Downloads', `Failed to fetch queue: ${err}`);
      return [];
    }
  });

  // Library stats
  app.get('/stats', async () => {
    try {
      const [radarr, sonarr] = await Promise.all([
        getArrClient('radarr'),
        getArrClient('sonarr'),
      ]);
      const [radarrMedia, sonarrMedia] = await Promise.all([
        radarr.getAllMedia(),
        sonarr.getAllMedia(),
      ]);

      return {
        radarr: {
          totalMovies: radarrMedia.length,
          moviesWithFiles: radarrMedia.filter(m => m.statusCategory === 'AVAILABLE').length,
          monitoredMovies: radarrMedia.length, // All synced media is monitored by definition in getAllMedia
          totalSizeOnDisk: 0, // Not available via normalized interface
        },
        sonarr: {
          totalSeries: sonarrMedia.length,
          monitoredSeries: sonarrMedia.length,
          totalEpisodes: sonarrMedia.reduce((acc, s) => acc + (s.seasons?.reduce((a, se) => a + se.totalEpisodeCount, 0) ?? 0), 0),
          downloadedEpisodes: sonarrMedia.reduce((acc, s) => acc + (s.seasons?.reduce((a, se) => a + se.episodeFileCount, 0) ?? 0), 0),
          totalSizeOnDisk: 0,
        },
      };
    } catch (err) {
      logEvent('debug', 'Stats', `Failed to fetch library stats: ${err}`);
      return { error: 'Unable to retrieve statistics' };
    }
  });

  // Calendar: upcoming releases
  app.get('/calendar', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'string', description: 'Number of days to look ahead (default 30, max 90)' },
        },
      },
    },

  }, async (request) => {
    const { days } = request.query as { days?: string };
    const numDays = Math.min(Number.parseInt(days || '30', 10) || 30, 90);
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + numDays * 86400000).toISOString().slice(0, 10);

    try {
      const [radarr, sonarr] = await Promise.all([
        getArrClient('radarr'),
        getArrClient('sonarr'),
      ]);
      const [movies, episodes] = await Promise.all([
        radarr.getCalendar(start, end),
        sonarr.getCalendar(start, end),
      ]);

      // Cast calendar results to the shapes returned by each provider
      const movieItems = movies as { title: string; tmdbId: number; hasFile: boolean; digitalRelease?: string; physicalRelease?: string; inCinemas?: string; releaseDate?: string; images?: { coverType: string; remoteUrl: string }[] }[];
      const episodeItems = episodes as { seriesId: number; seasonNumber: number; episodeNumber: number; title: string; airDateUtc: string; hasFile?: boolean; series: { title: string; tvdbId: number; images: { coverType: string; remoteUrl: string }[] } }[];

      // Resolve tvdbId -> tmdbId for episodes via DB
      const tvdbIds = [...new Set(episodeItems.map((e) => e.series?.tvdbId).filter(Boolean))] as number[];
      const tvdbToTmdb = new Map<number, number>();
      if (tvdbIds.length > 0) {
        const dbMedia = await prisma.media.findMany({
          where: { tvdbId: { in: tvdbIds }, mediaType: 'tv', tmdbId: { gt: 0 } },
          select: { tvdbId: true, tmdbId: true },
        });
        for (const m of dbMedia) {
          if (m.tvdbId) tvdbToTmdb.set(m.tvdbId, m.tmdbId);
        }
      }

      const items = [
        ...movieItems.map((m) => ({
          type: 'movie' as const,
          title: m.title,
          date: m.digitalRelease || m.physicalRelease || m.inCinemas || m.releaseDate || '',
          tmdbId: m.tmdbId,
          poster: m.images?.find((i) => i.coverType === 'poster')?.remoteUrl || null,
          hasFile: m.hasFile,
        })),
        ...episodeItems.map((e) => ({
          type: 'episode' as const,
          title: e.series?.title || 'Unknown series',
          episodeTitle: e.title,
          season: e.seasonNumber,
          episode: e.episodeNumber,
          date: e.airDateUtc,
          tvdbId: e.series?.tvdbId,
          tmdbId: e.series?.tvdbId ? tvdbToTmdb.get(e.series.tvdbId) ?? undefined : undefined,
          poster: e.series?.images?.find((i: { coverType: string }) => i.coverType === 'poster')?.remoteUrl || null,
          hasFile: !!e.hasFile,
        })),
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      return items;
    } catch (err) {
      logEvent('debug', 'Calendar', `Failed to fetch calendar: ${err}`);
      return [];
    }
  });
}
