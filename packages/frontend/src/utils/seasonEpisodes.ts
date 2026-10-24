import type { TmdbEpisode } from '@oscarr/shared';
import type { EpisodeInfo } from './episodeStatus';

/** Metadata exists independently of library tracking; unmatched files remain unknown. */
export function mergeSeasonEpisodes(metadata: TmdbEpisode[] | null, library: EpisodeInfo[] | null): EpisodeInfo[] {
  const episodes = new Map((library ?? []).map(ep => [ep.episodeNumber, ep]));
  for (const ep of metadata ?? []) {
    const stored = episodes.get(ep.episode_number);
    episodes.set(ep.episode_number, {
      episodeNumber: ep.episode_number,
      title: ep.name || stored?.title || '',
      airDateUtc: stored?.airDateUtc || ep.air_date,
      hasFile: stored?.hasFile ?? null,
      monitored: stored?.monitored ?? false,
      quality: stored?.quality ?? null,
      size: stored?.size ?? null,
    });
  }
  return [...episodes.values()].sort((a, b) => a.episodeNumber - b.episodeNumber);
}
