export interface EpisodeInfo {
  episodeNumber: number;
  title: string;
  airDateUtc: string | null;
  hasFile: boolean;
  monitored: boolean;
  quality: string | null;
  size: number | null;
}

export type EpisodeState = 'available' | 'missing' | 'upcoming' | 'downloading' | 'undated';
type DatedEpisode = Pick<EpisodeInfo, 'airDateUtc' | 'hasFile'>;

export function episodeState(episode: DatedEpisode, now: number, downloading = false): EpisodeState {
  if (episode.hasFile) return 'available';
  if (downloading) return 'downloading';
  const date = episode.airDateUtc ? Date.parse(episode.airDateUtc) : NaN;
  if (!Number.isFinite(date)) return 'undated';
  return date > now ? 'upcoming' : 'missing';
}

export function nextEpisodeDate(episodes: DatedEpisode[], now: number): string | null {
  return episodes.filter(ep => ep.airDateUtc && Date.parse(ep.airDateUtc) > now)
    .sort((a, b) => Date.parse(a.airDateUtc!) - Date.parse(b.airDateUtc!))[0]?.airDateUtc ?? null;
}

export function episodeTitle(title: string, fallback: string): string {
  return !title.trim() || /^(TBA|TBD)$/i.test(title.trim()) ? fallback : title;
}
