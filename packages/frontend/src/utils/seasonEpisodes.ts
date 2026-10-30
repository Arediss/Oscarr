import type { TmdbEpisode } from '@oscarr/shared';
import type { EpisodeInfo } from './episodeStatus';

/** Choose one numbering scheme. Identical episode numbers never prove matching identity. */
export function selectSeasonEpisodes(metadata: TmdbEpisode[] | null, library: EpisodeInfo[] | null): EpisodeInfo[] {
  const episodes = library ?? (metadata ?? []).map(ep => ({
      episodeNumber: ep.episode_number,
      title: ep.name || '', airDateUtc: ep.air_date,
      hasFile: null, monitored: false, quality: null, size: null,
  }));
  return [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
}
