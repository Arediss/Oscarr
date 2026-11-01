import { useEffect, useRef, useState, memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api, { backdropUrl } from '@/lib/api';
import { useDragScroll } from '@/hooks/useDragScroll';

export interface GenreItem {
  id: number;
  nameKey: string;
  mediaType: 'movie' | 'tv';
}

const GENRE_GRADIENTS: Record<number, string> = {
  28: 'from-red-600 to-orange-500',
  12: 'from-emerald-600 to-teal-500',
  16: 'from-violet-600 to-purple-500',
  35: 'from-amber-500 to-yellow-400',
  80: 'from-slate-700 to-gray-600',
  99: 'from-teal-600 to-cyan-500',
  18: 'from-blue-700 to-indigo-600',
  10751: 'from-pink-500 to-rose-400',
  14: 'from-purple-700 to-fuchsia-500',
  36: 'from-amber-700 to-orange-600',
  27: 'from-red-800 to-red-600',
  10402: 'from-fuchsia-600 to-pink-500',
  9648: 'from-indigo-700 to-violet-600',
  10749: 'from-rose-600 to-pink-400',
  878: 'from-cyan-600 to-blue-500',
  53: 'from-gray-800 to-zinc-600',
  10752: 'from-stone-700 to-zinc-600',
  37: 'from-orange-700 to-amber-600',
  10759: 'from-red-600 to-orange-500',
  10762: 'from-pink-500 to-rose-400',
  10765: 'from-purple-700 to-fuchsia-500',
  10768: 'from-stone-700 to-zinc-600',
};

const DEFAULT_GRADIENT = 'from-ndp-accent to-purple-600';

const GENRE_OVERLAY_COLORS: Record<number, string> = {
  28: 'rgba(220,38,38,0.65), rgba(249,115,22,0.4)',
  12: 'rgba(5,150,105,0.65), rgba(20,184,166,0.4)',
  16: 'rgba(124,58,237,0.65), rgba(168,85,247,0.4)',
  35: 'rgba(245,158,11,0.65), rgba(250,204,21,0.4)',
  80: 'rgba(71,85,105,0.65), rgba(75,85,99,0.4)',
  99: 'rgba(13,148,136,0.65), rgba(6,182,212,0.4)',
  18: 'rgba(29,78,216,0.65), rgba(79,70,229,0.4)',
  10751: 'rgba(236,72,153,0.65), rgba(251,113,133,0.4)',
  14: 'rgba(126,34,206,0.65), rgba(217,70,239,0.4)',
  36: 'rgba(180,83,9,0.65), rgba(234,88,12,0.4)',
  27: 'rgba(153,27,27,0.65), rgba(220,38,38,0.4)',
  10402: 'rgba(192,38,211,0.65), rgba(236,72,153,0.4)',
  9648: 'rgba(67,56,202,0.65), rgba(124,58,237,0.4)',
  10749: 'rgba(225,29,72,0.65), rgba(244,114,182,0.4)',
  878: 'rgba(8,145,178,0.65), rgba(59,130,246,0.4)',
  53: 'rgba(39,39,42,0.65), rgba(82,82,91,0.4)',
  10752: 'rgba(68,64,60,0.65), rgba(82,82,91,0.4)',
  37: 'rgba(194,65,12,0.65), rgba(217,119,6,0.4)',
};

const DEFAULT_OVERLAY = 'rgba(109,40,217,0.65), rgba(147,51,234,0.4)';

// Deduplicated genre list - one card per genre name
// Genres shared by movie & TV use the movie ID (TMDB discover works with both)
export const ALL_GENRES: GenreItem[] = [
  { id: 28, nameKey: 'genre.action', mediaType: 'movie' },
  { id: 12, nameKey: 'genre.adventure', mediaType: 'movie' },
  { id: 16, nameKey: 'genre.animation', mediaType: 'movie' },
  { id: 35, nameKey: 'genre.comedy', mediaType: 'movie' },
  { id: 80, nameKey: 'genre.crime', mediaType: 'movie' },
  { id: 99, nameKey: 'genre.documentary', mediaType: 'movie' },
  { id: 18, nameKey: 'genre.drama', mediaType: 'movie' },
  { id: 10751, nameKey: 'genre.family', mediaType: 'movie' },
  { id: 14, nameKey: 'genre.fantasy', mediaType: 'movie' },
  { id: 36, nameKey: 'genre.history', mediaType: 'movie' },
  { id: 27, nameKey: 'genre.horror', mediaType: 'movie' },
  { id: 10402, nameKey: 'genre.music', mediaType: 'movie' },
  { id: 9648, nameKey: 'genre.mystery', mediaType: 'movie' },
  { id: 10749, nameKey: 'genre.romance', mediaType: 'movie' },
  { id: 878, nameKey: 'genre.science_fiction', mediaType: 'movie' },
  { id: 53, nameKey: 'genre.thriller', mediaType: 'movie' },
  { id: 10752, nameKey: 'genre.war', mediaType: 'movie' },
  { id: 37, nameKey: 'genre.western', mediaType: 'movie' },
];

function GenreRow() {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  useDragScroll(scrollRef, ALL_GENRES.length);
  const [backdrops, setBackdrops] = useState<Record<number, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    api.get<Record<number, string | null>>('/tmdb/genre-backdrops')
      .then(({ data }) => {
        if (cancelled) return;
        setBackdrops(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.8;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  return (
    <section className="relative group/row">
      <h2 className="text-xl font-bold text-ndp-text mb-4 px-4 sm:px-8">{t('genre.title')}</h2>

      <div className="relative">
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-r from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-l from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto px-4 sm:px-8 py-12 -my-12"
          style={{ scrollbarWidth: 'none' }}
        >
          {ALL_GENRES.map((genre) => {
            const gradient = GENRE_GRADIENTS[genre.id] || DEFAULT_GRADIENT;
            const bdPath = backdrops[genre.id];
            return (
              <Link
                key={genre.id}
                to={`/discover/${genre.mediaType}/genre/${genre.id}`}
                className="flex-shrink-0 group/card"
              >
                <div
                  className={`w-[180px] sm:w-[200px] h-[100px] sm:h-[110px] rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center relative overflow-hidden will-change-transform transition-[transform,box-shadow] duration-300 hover:scale-105 hover:shadow-xl`}
                >
                  {bdPath && (
                    <>
                      <img
                        src={backdropUrl(bdPath, 'w780')}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover/card:opacity-100 transition-opacity duration-[400ms] ease-in-out"
                      />
                      <div
                        className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-[400ms] ease-in-out pointer-events-none"
                        style={{ background: `linear-gradient(135deg, ${GENRE_OVERLAY_COLORS[genre.id] || DEFAULT_OVERLAY})` }}
                      />
                    </>
                  )}
                  <div className="absolute inset-0 bg-black/10" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />

                  <span className="relative z-10 text-white font-bold text-base sm:text-lg text-center px-4 drop-shadow-lg">
                    {t(genre.nameKey)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default memo(GenreRow);
