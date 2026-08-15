import type { ArrClient, ArrMediaItem, ArrAvailabilityResult, ArrHistoryEntry, ArrAddMediaOptions, ArrEpisode, ArrWebhookEvent } from '../types.js';
import { extractImageFromArr } from '../types.js';
import type { SonarrSeries, SonarrSeason, SonarrQueueItem, SonarrEpisode, SonarrEpisodeFile, SonarrHistoryRecord } from './types.js';
import type { MediaStateCategory } from '@oscarr/shared';
import { logEvent } from '../../utils/logEvent.js';
import { ArrClientBase } from '../arrClientBase.js';

export class SonarrClient extends ArrClientBase implements ArrClient {
  readonly mediaType = 'tv' as const;
  readonly serviceType = 'sonarr';
  readonly defaultRootFolder = '/tv';

  constructor(url: string, apiKey: string) {
    super(url, apiKey, 'Sonarr');
  }

  async getSeries(): Promise<SonarrSeries[]> {
    const { data } = await this.api.get('/series');
    return data;
  }

  async getSeriesById(id: number): Promise<SonarrSeries> {
    const { data } = await this.api.get(`/series/${id}`);
    return data;
  }

  async getSeriesByTvdbId(tvdbId: number): Promise<SonarrSeries | null> {
    const { data } = await this.api.get('/series', { params: { tvdbId } });
    return data[0] ?? null;
  }

  async addSeries(options: {
    title: string;
    tvdbId: number;
    qualityProfileId: number;
    rootFolderPath: string;
    seasons: number[];
    seriesType?: 'standard' | 'anime' | 'daily';
    tags?: number[];
    monitored?: boolean;
    searchForMissingEpisodes?: boolean;
  }): Promise<SonarrSeries> {
    const lookupData = await this.lookupByTvdbId(options.tvdbId);
    if (!lookupData) throw new Error(`Series not found on TVDB: ${options.tvdbId}`);

    const monitorAll = !options.seasons || options.seasons.length === 0;
    const seasons = lookupData.seasons.map((s: SonarrSeason) => ({
      seasonNumber: s.seasonNumber,
      monitored: s.seasonNumber > 0 && (monitorAll || options.seasons.includes(s.seasonNumber)),
    }));

    const { data } = await this.api.post('/series', {
      ...lookupData,
      qualityProfileId: options.qualityProfileId,
      rootFolderPath: options.rootFolderPath,
      seriesType: options.seriesType ?? 'standard',
      tags: options.tags ?? [],
      monitored: options.monitored ?? true,
      seasons,
      addOptions: {
        searchForMissingEpisodes: options.searchForMissingEpisodes ?? true,
      },
    });
    return data;
  }

  async lookupByTvdbId(tvdbId: number): Promise<SonarrSeries | null> {
    const { data } = await this.api.get('/series/lookup', { params: { term: `tvdb:${tvdbId}` } });
    return data[0] ?? null;
  }

  async getCalendar(start: string, end: string): Promise<{ seriesId: number; seasonNumber: number; episodeNumber: number; title: string; airDateUtc: string; series: { title: string; tvdbId: number; images: { coverType: string; remoteUrl: string }[] } }[]> {
    const { data } = await this.api.get('/calendar', { params: { start, end, includeSeries: true } });
    return data;
  }

  async getQueue(): Promise<{ records: SonarrQueueItem[] }> {
    const { data } = await this.api.get('/queue', {
      params: { pageSize: 50, includeSeries: true, includeEpisode: true },
    });
    return data;
  }

  async getEpisodes(seriesId: number, seasonNumber?: number): Promise<SonarrEpisode[]> {
    const params: Record<string, unknown> = { seriesId };
    if (seasonNumber !== undefined) params.seasonNumber = seasonNumber;
    const { data } = await this.api.get('/episode', { params });
    return data;
  }

  async getEpisodeFiles(seriesId: number): Promise<SonarrEpisodeFile[]> {
    const { data } = await this.api.get('/episodefile', { params: { seriesId } });
    return data;
  }

  async searchMissingEpisodes(seriesId: number): Promise<void> {
    await this.api.post('/command', { name: 'MissingEpisodeSearch', seriesId });
  }

  async getHistory(since?: Date | null): Promise<SonarrHistoryRecord[]> {
    if (since) {
      const { data } = await this.api.get('/history/since', { params: { date: since.toISOString(), includeEpisode: true } });
      return (Array.isArray(data) ? data : data.records ?? [])
        .filter((r: SonarrHistoryRecord) => r.eventType === 'downloadFolderImported');
    }
    const all: SonarrHistoryRecord[] = [];
    let page = 1;
    while (true) {
      try {
        const { data } = await this.api.get('/history', {
          params: { pageSize: 500, page, sortKey: 'date', sortDirection: 'descending', includeEpisode: true },
        });
        const records: SonarrHistoryRecord[] = data.records ?? data;
        all.push(...records.filter(r => r.eventType === 'downloadFolderImported'));
        if (records.length < 500) break;
        page++;
      } catch (err) {
        // Sonarr can crash on corrupted history entries — log details for debugging
        const statusCode = (err as { response?: { status?: number } })?.response?.status;
        const errorBody = (err as { response?: { data?: unknown } })?.response?.data;
        logEvent('debug', 'Sonarr', `History pagination failed at page ${page} (records ${(page - 1) * 500}-${page * 500}), HTTP ${statusCode || 'unknown'}`);
        if (errorBody) logEvent('debug', 'Sonarr', `Error details: ${typeof errorBody === 'string' ? errorBody.slice(0, 500) : JSON.stringify(errorBody).slice(0, 500)}`);
        logEvent('debug', 'Sonarr', `Using ${all.length} records collected so far`);
        break;
      }
    }
    return all;
  }

  // ─── Normalized interface methods ─────────────────────────────────

  /** Maps native Sonarr state to the Oscarr vocabulary. Reused for series and seasons. */
  private resolveState(
    stats: { percentOfEpisodes: number; episodeFileCount: number } | undefined,
    monitored: boolean,
    inActiveQueue: boolean,
    nativeStatus?: string,
  ): MediaStateCategory {
    if (stats && stats.percentOfEpisodes >= 100) return 'AVAILABLE';
    if (inActiveQueue) return 'PROCESSING';
    if (stats && stats.episodeFileCount > 0) return 'PROCESSING';
    if (nativeStatus === 'upcoming') return 'UPCOMING';
    if (monitored) return 'SEARCHING';
    return 'UNAVAILABLE';
  }

  private seriesToArrItem(
    show: SonarrSeries,
    active: { seriesIds: ReadonlySet<number>; seasonKeys: ReadonlySet<string> },
  ): ArrMediaItem {
    return {
      serviceMediaId: show.id,
      externalId: show.tvdbId,
      tmdbId: show.tmdbId && show.tmdbId > 0 ? show.tmdbId : undefined,
      title: show.title,
      statusCategory: this.resolveState(show.statistics, show.monitored, active.seriesIds.has(show.id), show.status),
      posterPath: extractImageFromArr(show.images, 'poster'),
      backdropPath: extractImageFromArr(show.images, 'fanart'),
      qualityProfileId: show.qualityProfileId,
      addedDate: show.added || null,
      tags: show.tags || [],
      hasFile: (show.statistics?.percentOfEpisodes ?? 0) >= 100,
      seasons: show.seasons
        .filter(s => s.seasonNumber > 0)
        .map(s => ({
          seasonNumber: s.seasonNumber,
          monitored: s.monitored,
          episodeFileCount: s.statistics?.episodeFileCount ?? 0,
          totalEpisodeCount: s.statistics?.totalEpisodeCount ?? 0,
          percentComplete: s.statistics?.percentOfEpisodes ?? 0,
          // no per-season status from Sonarr → nativeStatus omitted (seasons never UPCOMING)
          statusCategory: this.resolveState(s.statistics, s.monitored, active.seasonKeys.has(`${show.id}:${s.seasonNumber}`)),
        })),
    };
  }

  /** Sonarr download queue → active series ids + seriesId:seasonNumber keys (⇒ PROCESSING). */
  private async getActiveQueue(): Promise<{ seriesIds: Set<number>; seasonKeys: Set<string> }> {
    try {
      const { records } = await this.getQueue();
      const seriesIds = new Set<number>();
      const seasonKeys = new Set<string>();
      for (const r of records) {
        seriesIds.add(r.seriesId);
        if (r.episode?.seasonNumber != null) seasonKeys.add(`${r.seriesId}:${r.episode.seasonNumber}`);
      }
      return { seriesIds, seasonKeys };
    } catch {
      return { seriesIds: new Set(), seasonKeys: new Set() };
    }
  }

  async getAllMedia(): Promise<ArrMediaItem[]> {
    const [series, active] = await Promise.all([this.getSeries(), this.getActiveQueue()]);
    return series.map((s) => this.seriesToArrItem(s, active));
  }

  async getMediaById(serviceMediaId: number): Promise<ArrMediaItem | null> {
    try {
      const [series, active] = await Promise.all([this.getSeriesById(serviceMediaId), this.getActiveQueue()]);
      return series ? this.seriesToArrItem(series, active) : null;
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
  }

  async checkAvailability(tvdbId: number): Promise<ArrAvailabilityResult> {
    const series = await this.getSeriesByTvdbId(tvdbId);
    if (!series) {
      return { available: false, audioLanguages: null, subtitleLanguages: null };
    }

    const stats = series.statistics;
    const seasonStats = series.seasons
      .filter((s) => s.seasonNumber > 0)
      .map((s) => ({
        seasonNumber: s.seasonNumber,
        episodeFileCount: s.statistics?.episodeFileCount ?? 0,
        episodeCount: s.statistics?.episodeCount ?? 0,
        totalEpisodeCount: s.statistics?.totalEpisodeCount ?? 0,
      }));

    // No files means nothing to read languages from, and the extra request would always come back
    // empty.
    const languages = stats?.episodeFileCount
      ? await this.episodeLanguages(series.id)
      : { audioLanguages: null, subtitleLanguages: null };

    return {
      available: stats ? stats.percentOfEpisodes >= 100 : false,
      ...languages,
      seasonStats,
    };
  }

  /** Languages carried by most of the series' episode files. Failure is not fatal: language data
   *  is a nicety, and losing it must never make an available series look unavailable. */
  private async episodeLanguages(seriesId: number): Promise<{ audioLanguages: string[] | null; subtitleLanguages: string[] | null }> {
    try {
      const files = await this.getEpisodeFiles(seriesId);
      const audio = new Map<string, number>();
      const subs = new Map<string, number>();
      for (const file of files) {
        tallyLanguages(file.mediaInfo?.audioLanguages, audio);
        tallyLanguages(file.mediaInfo?.subtitles, subs);
      }
      return {
        audioLanguages: dominantLanguages(audio, files.length),
        subtitleLanguages: dominantLanguages(subs, files.length),
      };
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      logEvent('debug', 'Sonarr', `Failed to fetch episode files for series ${seriesId} (HTTP ${status || 'unknown'}), skipping language data`);
      return { audioLanguages: null, subtitleLanguages: null };
    }
  }

  async findByExternalId(tvdbId: number): Promise<{ id: number } | null> {
    const series = await this.getSeriesByTvdbId(tvdbId);
    return series ? { id: series.id } : null;
  }

  async addMedia(options: ArrAddMediaOptions): Promise<void> {
    await this.addSeries({
      title: options.title,
      tvdbId: options.externalId,
      qualityProfileId: options.qualityProfileId,
      rootFolderPath: options.rootFolderPath,
      seriesType: (options.seriesType as 'standard' | 'anime' | 'daily') || 'standard',
      seasons: options.seasons || [],
      tags: options.tags,
      searchForMissingEpisodes: true,
    });
  }

  async searchMedia(seriesId: number): Promise<void> {
    await this.searchMissingEpisodes(seriesId);
  }

  async deleteMedia(seriesId: number, deleteFiles = true): Promise<void> {
    await this.api.delete(`/series/${seriesId}`, { params: { deleteFiles } });
  }

  async getEpisodesNormalized(serviceMediaId: number, seasonNumber?: number): Promise<ArrEpisode[]> {
    const episodes = await this.getEpisodes(serviceMediaId, seasonNumber);
    return episodes.map(ep => ({
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      airDateUtc: ep.airDateUtc,
      hasFile: ep.hasFile,
      monitored: ep.monitored,
      quality: ep.episodeFile?.quality?.quality?.name || null,
      size: ep.episodeFile?.size || null,
    }));
  }

  async getHistoryEntries(since?: Date | null): Promise<ArrHistoryEntry[]> {
    const records = await this.getHistory(since);
    return records.map(r => ({
      serviceMediaId: r.seriesId,
      date: new Date(r.date),
      extraData: r.episode ? { episode: { season: r.episode.seasonNumber, episode: r.episode.episodeNumber, title: r.episode.title } } : undefined,
    }));
  }

  async registerWebhook(name: string, url: string, apiKey: string): Promise<number> {
    const { data } = await this.api.post('/notification', {
      name,
      implementation: 'Webhook',
      configContract: 'WebhookSettings',
      onDownload: true,
      onUpgrade: true,
      onImportComplete: true,
      onSeriesAdd: true,
      onSeriesDelete: true,
      includeHealthWarnings: false,
      fields: [
        { name: 'url', value: url },
        { name: 'method', value: 1 },
        { name: 'username', value: '' },
        { name: 'password', value: apiKey },
      ],
    });
    return data.id;
  }

  getWebhookEvents() {
    return [
      { key: 'Download', label: 'Import', description: 'When an episode file is imported' },
      { key: 'Upgrade', label: 'Upgrade', description: 'When an episode is upgraded to better quality' },
      { key: 'SeriesAdd', label: 'Series added', description: 'When a series is added to the library' },
      { key: 'SeriesDelete', label: 'Series deleted', description: 'When a series is removed from the library' },
    ];
  }

  parseWebhookPayload(body: unknown): ArrWebhookEvent | null {
    const payload = body as { eventType?: string; series?: { id?: number; tvdbId?: number; title?: string }; episodes?: { seasonNumber?: number; episodeNumber?: number }[] };
    if (!payload.eventType) return null;
    if (payload.eventType === 'Test') return { type: 'test', externalId: 0, title: 'Test' };
    if (!payload.series?.tvdbId) return null;
    const typeMap: Record<string, ArrWebhookEvent['type']> = { Download: 'download', Grab: 'grab', SeriesAdd: 'added', SeriesDelete: 'deleted' };
    const ep = payload.episodes?.[0];
    return {
      type: typeMap[payload.eventType] || 'unknown',
      externalId: payload.series.tvdbId,
      internalId: payload.series.id,
      title: payload.series.title || 'Unknown',
      seasonNumber: ep?.seasonNumber,
      episodeNumber: ep?.episodeNumber,
    };
  }
}

/** Counts each language once per file — a file listing "fre/fre" must not weigh double. */
function tallyLanguages(raw: string | undefined, counts: Map<string, number>): void {
  if (!raw) return;
  const seen = new Set<string>();
  for (const part of raw.split('/')) {
    const lang = part.trim();
    if (!lang || seen.has(lang)) continue;
    seen.add(lang);
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
}

/** Kept only when present in at least half the files: one oddly-encoded episode must not make a
 *  whole series look multilingual. Null rather than an empty array, so callers can tell "no data"
 *  from "nothing dominant". */
function dominantLanguages(counts: Map<string, number>, fileCount: number): string[] | null {
  const threshold = Math.max(1, Math.floor(fileCount * 0.5));
  const kept = [...counts.entries()].filter(([, c]) => c >= threshold).map(([lang]) => lang);
  return kept.length > 0 ? kept : null;
}
