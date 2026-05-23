import { useRef, memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import MediaCard, { MediaCardSkeleton } from './MediaCard';
import { useMediaStatus, getStatusForMedia } from '@/hooks/useMediaStatus';
import type { TmdbMedia } from '@/types';

interface MediaRowProps {
  title: string;
  media: TmdbMedia[];
  loading?: boolean;
  href?: string;
  size?: 'default' | 'large';
}

const SIZE_CLASSES = {
  default: 'w-[140px] sm:w-[160px] lg:w-[180px]',
  large: 'w-[180px] sm:w-[210px] lg:w-[240px]',
};

function MediaRow({ title, media, loading, href, size = 'default' }: Readonly<MediaRowProps>) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const statuses = useMediaStatus(media);

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
      {/* z-10 keeps the header above the scroll container's invisible padding zone
       *  (the row uses py-12 -my-12 to give cards room to scale on hover — without
       *  the z-index the header click target is swallowed by that padding). */}
      <div className="relative z-10 flex items-center gap-2 mb-4 px-4 sm:px-8">
        {href ? (
          <Link
            to={href}
            className="flex items-center gap-2 text-ndp-text hover:text-ndp-accent transition-colors group/link"
            title={t('home.more_info')}
            aria-label={t('home.more_info')}
          >
            <h2 className="text-xl font-bold">{title}</h2>
            <ArrowRight className="w-5 h-5 text-ndp-text-dim group-hover/link:text-ndp-accent group-hover/link:translate-x-0.5 transition-all" />
          </Link>
        ) : (
          <h2 className="text-xl font-bold text-ndp-text">{title}</h2>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-0 bottom-0 z-20 w-12 bg-gradient-to-r from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-0 bottom-0 z-20 w-12 bg-gradient-to-l from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto px-4 sm:px-8 py-12 -my-12"
          style={{ scrollbarWidth: 'none' }}
        >
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <MediaCardSkeleton key={`skel-${i}`} className={SIZE_CLASSES[size]} />
              ))
            : media.map((item, i) => {
                const type = item.media_type || (item.title ? 'movie' : 'tv');
                return (
                  <MediaCard
                    key={`${type}-${item.id}`}
                    media={item}
                    className={SIZE_CLASSES[size]}
                    availability={getStatusForMedia(statuses, item.id, type)}
                    index={i}
                  />
                );
              })}
        </div>
      </div>
    </section>
  );
}

export default memo(MediaRow);
