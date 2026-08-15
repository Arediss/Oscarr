import type { TmdbCast, TmdbCrew } from '@/types';

interface TmdbLike {
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  genres?: { name: string }[];
  videos?: { results?: { type: string; site: string; key: string }[] };
  credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
}

/** The handful of display values every media surface derives from a TMDB payload. Pulled out of
 *  the page so the component reads as layout, not as a pile of optional-chaining. */
export function mediaSummary(media: TmdbLike) {
  return {
    title: media.title || media.name || '',
    year: (media.release_date || media.first_air_date || '').slice(0, 4),
    genres: media.genres?.map((g) => g.name).join(', '),
    trailer: media.videos?.results?.find((v) => v.type === 'Trailer' && v.site === 'YouTube'),
    cast: media.credits?.cast?.slice(0, 20) ?? [],
    director: media.credits?.crew?.find((c) => c.job === 'Director'),
  };
}
