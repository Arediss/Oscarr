import axios, { type AxiosInstance } from 'axios';
import type {
  TautulliActivity,
  TautulliHistory,
  TautulliHomeStat,
  TautulliPlaysByDate,
  TautulliResponse,
  TautulliUsersTable,
  TautulliUserWatchTime,
} from './types.js';
import { trimTrailingSlashes } from '../../utils/trimTrailingSlashes.js';

export class TautulliClient {
  private readonly api: AxiosInstance;

  constructor(url: string, apiKey: string) {
    const cleanUrl = trimTrailingSlashes(url);
    this.api = axios.create({
      baseURL: `${cleanUrl}/api/v2`,
      params: { apikey: apiKey },
      timeout: 10_000,
    });
  }

  /** Low-level escape hatch for commands not covered by typed helpers. */
  async request<T>(cmd: string, params?: Record<string, unknown>): Promise<T> {
    const { data } = await this.api.get<TautulliResponse<T>>('', { params: { cmd, ...(params ?? {}) } });
    if (!data?.response) {
      throw new Error('Tautulli: unexpected response shape');
    }
    if (data.response.result !== 'success') {
      throw new Error(`Tautulli: ${data.response.message || 'unknown error'}`);
    }
    return data.response.data;
  }

  /** `arnold` is Tautulli's canonical "are you alive" endpoint — returns a random quote. */
  async ping(): Promise<{ quote?: string; version?: string }> {
    return this.request<{ quote?: string; version?: string }>('arnold');
  }

  async getActivity(): Promise<TautulliActivity> {
    return this.request<TautulliActivity>('get_activity');
  }

  async getUsersTable(params?: {
    length?: number;
    start?: number;
    orderColumn?: string;
    orderDir?: 'asc' | 'desc';
    search?: string;
  }): Promise<TautulliUsersTable> {
    return this.request<TautulliUsersTable>('get_users_table', {
      length: params?.length ?? 1000,
      start: params?.start ?? 0,
      order_column: params?.orderColumn ?? 'plays',
      order_dir: params?.orderDir ?? 'desc',
      search: params?.search,
    });
  }

  async getHistory(params?: {
    userId?: number;
    mediaType?: 'movie' | 'episode' | 'track' | string;
    ratingKey?: string;
    length?: number;
    start?: number;
    orderColumn?: string;
    orderDir?: 'asc' | 'desc';
  }): Promise<TautulliHistory> {
    return this.request<TautulliHistory>('get_history', {
      user_id: params?.userId,
      media_type: params?.mediaType,
      rating_key: params?.ratingKey,
      length: params?.length ?? 100,
      start: params?.start ?? 0,
      order_column: params?.orderColumn ?? 'date',
      order_dir: params?.orderDir ?? 'desc',
    });
  }

  async getHomeStats(params?: {
    timeRange?: number;
    statsCount?: number;
    statsType?: 'plays' | 'duration';
    statId?: string;
  }): Promise<TautulliHomeStat[]> {
    return this.request<TautulliHomeStat[]>('get_home_stats', {
      time_range: params?.timeRange ?? 30,
      stats_count: params?.statsCount ?? 10,
      stats_type: params?.statsType ?? 'plays',
      stat_id: params?.statId,
    });
  }

  async getUserWatchTimeStats(
    userId: number,
    params?: { grouping?: 0 | 1; queryDays?: string }
  ): Promise<TautulliUserWatchTime[]> {
    return this.request<TautulliUserWatchTime[]>('get_user_watch_time_stats', {
      user_id: userId,
      grouping: params?.grouping ?? 1,
      query_days: params?.queryDays ?? '1,7,30,0',
    });
  }

  async getPlaysByDate(params?: {
    timeRange?: number;
    userId?: number;
    yAxis?: 'plays' | 'duration';
  }): Promise<TautulliPlaysByDate> {
    return this.request<TautulliPlaysByDate>('get_plays_by_date', {
      time_range: params?.timeRange ?? 30,
      user_id: params?.userId,
      y_axis: params?.yAxis ?? 'plays',
    });
  }
}

/** Build a client from a service config row. */
export function createTautulliClient(config: { url: string; apiKey: string }): TautulliClient {
  return new TautulliClient(config.url, config.apiKey);
}
