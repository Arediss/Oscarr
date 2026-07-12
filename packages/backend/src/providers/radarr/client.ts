import type { ArrClient, ArrMediaItem, ArrAvailabilityResult, ArrHistoryEntry, ArrAddMediaOptions, ArrWebhookEvent } from '../types.js';
import { extractImageFromArr } from '../types.js';
import type { RadarrMovie, RadarrQueueItem, RadarrHistoryRecord } from './types.js';
import type { MediaStateCategory } from '@oscarr/shared';
import { logEvent } from '../../utils/logEvent.js';
import { ArrClientBase } from '../arrClientBase.js';

export class RadarrClient extends ArrClientBase implements ArrClient {
  readonly mediaType = 'movie' as const;
  readonly serviceType = 'radarr';
  readonly dbIdField = 'radarrId' as const;
  readonly defaultRootFolder = '/movies';

  constructor(url: string, apiKey: string) {
    super(url, apiKey, 'Radarr');
  }

  async getMovies(): Promise<RadarrMovie[]> {
    const { data } = await this.api.get('/movie');
    return data;
  }

  async getMovie(id: number): Promise<RadarrMovie> {
    const { data } = await this.api.get(`/movie/${id}`);
    return data;
  }

  async searchMovie(movieId: number): Promise<void> {
    await this.api.post('/command', { name: 'MoviesSearch', movieIds: [movieId] });
  }

  async getMovieByTmdbId(tmdbId: number): Promise<RadarrMovie | null> {
    const { data } = await this.api.get('/movie', { params: { tmdbId } });
    return data[0] ?? null;
  }

  async addMovie(options: {
    title: string;
    tmdbId: number;
    qualityProfileId: number;
    rootFolderPath: string;
    tags?: number[];
    monitored?: boolean;
    searchForMovie?: boolean;
  }): Promise<RadarrMovie> {
    const { data } = await this.api.post('/movie', {
      title: options.title,
      tmdbId: options.tmdbId,
      qualityProfileId: options.qualityProfileId,
      rootFolderPath: options.rootFolderPath,
      tags: options.tags ?? [],
      monitored: options.monitored ?? true,
      addOptions: {
        searchForMovie: options.searchForMovie ?? true,
      },
    });
    return data;
  }

  async getCalendar(start: string, end: string): Promise<RadarrMovie[]> {
    const { data } = await this.api.get('/calendar', { params: { start, end } });
    return data;
  }

  async getQueue(): Promise<{ records: RadarrQueueItem[] }> {
    const { data } = await this.api.get('/queue', {
      params: { pageSize: 50, includeMovie: true },
    });
    return data;
  }

  async getHistory(since?: Date | null): Promise<RadarrHistoryRecord[]> {
    if (since) {
      const { data } = await this.api.get('/history/since', { params: { date: since.toISOString() } });
      return (Array.isArray(data) ? data : data.records ?? [])
        .filter((r: RadarrHistoryRecord) => r.eventType === 'downloadFolderImported');
    }
    // Paginated fetch — get enough records to cover the library
    const all: RadarrHistoryRecord[] = [];
    let page = 1;
    while (true) {
      try {
        const { data } = await this.api.get('/history', {
          params: { pageSize: 1000, page, sortKey: 'date', sortDirection: 'descending' },
        });
        const records: RadarrHistoryRecord[] = data.records ?? data;
        all.push(...records.filter(r => r.eventType === 'downloadFolderImported'));
        if (records.length < 1000) break;
        page++;
      } catch {
        logEvent('debug', 'Radarr', `History pagination failed at page ${page}, using ${all.length} records collected so far`);
        break;
      }
    }
    return all;
  }

  // ─── Normalized interface methods ─────────────────────────────────

  /** Maps native Radarr state (+ queue presence) to the Oscarr vocabulary. */
  private resolveState(movie: RadarrMovie, inActiveQueue: boolean): MediaStateCategory {
    if (movie.hasFile) return 'AVAILABLE';
    if (inActiveQueue) return 'PROCESSING';
    if (!movie.monitored) return 'UNAVAILABLE';
    // Transport Radarr's own signal: isAvailable=false (announced or cinema-only) → UPCOMING.
    if (!movie.isAvailable) return 'UPCOMING';
    return 'SEARCHING';
  }

  private movieToArrItem(movie: RadarrMovie, activeQueueIds: ReadonlySet<number>): ArrMediaItem {
    return {
      serviceMediaId: movie.id,
      externalId: movie.tmdbId,
      title: movie.title,
      statusCategory: this.resolveState(movie, activeQueueIds.has(movie.id)),
      posterPath: extractImageFromArr(movie.images, 'poster'),
      backdropPath: extractImageFromArr(movie.images, 'fanart'),
      qualityProfileId: movie.qualityProfileId,
      addedDate: movie.added || null,
      tags: movie.tags || [],
      hasFile: movie.hasFile,
    };
  }

  /** movieIds currently in the download queue (⇒ PROCESSING). Best-effort. */
  private async getActiveQueueIds(): Promise<Set<number>> {
    try {
      const { records } = await this.getQueue();
      return new Set(records.map((r) => r.movieId));
    } catch {
      return new Set();
    }
  }

  async getAllMedia(): Promise<ArrMediaItem[]> {
    const [movies, activeQueueIds] = await Promise.all([this.getMovies(), this.getActiveQueueIds()]);
    return movies.map((m) => this.movieToArrItem(m, activeQueueIds));
  }

  async getMediaById(serviceMediaId: number): Promise<ArrMediaItem | null> {
    try {
      const [{ data }, activeQueueIds] = await Promise.all([
        this.api.get<RadarrMovie>(`/movie/${serviceMediaId}`),
        this.getActiveQueueIds(),
      ]);
      return data ? this.movieToArrItem(data, activeQueueIds) : null;
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
  }

  async checkAvailability(tmdbId: number): Promise<ArrAvailabilityResult> {
    const movie = await this.getMovieByTmdbId(tmdbId);
    if (!movie?.hasFile) {
      return { available: false, audioLanguages: null, subtitleLanguages: null };
    }

    let audioLanguages: string[] | null = null;
    let subtitleLanguages: string[] | null = null;

    const mi = movie.movieFile?.mediaInfo;
    if (mi?.audioLanguages) {
      audioLanguages = mi.audioLanguages.split('/').map(s => s.trim()).filter(Boolean);
    } else if (movie.movieFile?.languages?.length) {
      audioLanguages = movie.movieFile.languages.map(l => l.name);
    }
    if (mi?.subtitles) {
      subtitleLanguages = mi.subtitles.split('/').map(s => s.trim()).filter(Boolean);
    }

    return { available: true, audioLanguages, subtitleLanguages };
  }

  async findByExternalId(tmdbId: number): Promise<{ id: number } | null> {
    const movie = await this.getMovieByTmdbId(tmdbId);
    return movie ? { id: movie.id } : null;
  }

  async addMedia(options: ArrAddMediaOptions): Promise<void> {
    await this.addMovie({
      title: options.title,
      tmdbId: options.externalId,
      qualityProfileId: options.qualityProfileId,
      rootFolderPath: options.rootFolderPath,
      tags: options.tags,
      searchForMovie: true,
    });
  }

  async searchMedia(movieId: number): Promise<void> {
    await this.searchMovie(movieId);
  }

  async deleteMedia(movieId: number, deleteFiles = true): Promise<void> {
    await this.api.delete(`/movie/${movieId}`, { params: { deleteFiles } });
  }

  async getHistoryEntries(since?: Date | null): Promise<ArrHistoryEntry[]> {
    const records = await this.getHistory(since);
    return records.map(r => ({
      serviceMediaId: r.movieId,
      date: new Date(r.date),
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
      onMovieAdded: true,
      onMovieDelete: true,
      includeHealthWarnings: false,
      fields: [
        { name: 'url', value: url },
        { name: 'method', value: 1 }, // POST
        { name: 'username', value: '' },
        { name: 'password', value: apiKey },
      ],
    });
    return data.id;
  }

  getWebhookEvents() {
    return [
      { key: 'Download', label: 'Import', description: 'When a movie file is imported' },
      { key: 'Upgrade', label: 'Upgrade', description: 'When a movie is upgraded to better quality' },
      { key: 'MovieAdded', label: 'Movie added', description: 'When a movie is added to the library' },
      { key: 'MovieDelete', label: 'Movie deleted', description: 'When a movie is removed from the library' },
    ];
  }

  parseWebhookPayload(body: unknown): ArrWebhookEvent | null {
    const payload = body as { eventType?: string; movie?: { id?: number; tmdbId?: number; title?: string } };
    if (!payload.eventType) return null;
    // Test event has no movie data
    if (payload.eventType === 'Test') return { type: 'test', externalId: 0, title: 'Test' };
    if (!payload.movie?.tmdbId) return null;
    const typeMap: Record<string, ArrWebhookEvent['type']> = { Download: 'download', Grab: 'grab', MovieAdded: 'added', MovieDelete: 'deleted' };
    return {
      type: typeMap[payload.eventType] || 'unknown',
      externalId: payload.movie.tmdbId,
      internalId: payload.movie.id,
      title: payload.movie.title || 'Unknown',
    };
  }
}
