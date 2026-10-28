import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  User,
  Clapperboard,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useNsfwFilter } from '@/hooks/useNsfwFilter';
import MediaRow from '@/components/MediaRow';
import CollectionSection from '@/components/CollectionSection';
import { useMediaDetailData } from '@/hooks/useMediaDetailData';
import { useMediaRequestActions } from '@/hooks/useMediaRequestActions';
import type { TmdbCast, TmdbCrew } from '@/types';
import { useMediaAvailability } from '@/hooks/useMediaAvailability';
import { NsfwRevealModal } from '@/components/media/NsfwRevealModal';
import { MediaInfoColumn } from '@/components/media/MediaInfoColumn';
import { MediaBackdrop } from '@/components/media/MediaHeroArt';
import '@/components/media/media-detail.css';
import { mediaSummary } from '@/utils/mediaSummary';
import { hasRequestableSeasons } from '@/utils/seasonFill';
import SeasonExplorer from '@/components/media/SeasonExplorer';
import MediaDetailLoading from '@/components/media/MediaDetailLoading';

interface Props {
  type: 'movie' | 'tv';
}

export default function MediaDetailPage({ type }: Readonly<Props>) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isNsfw, disableBlur } = useNsfwFilter();
  const [revealed, setRevealed] = useState(false);
  const [showNsfwModal, setShowNsfwModal] = useState(false);

  const {
    media, dbMedia, sonarrSeasons, inLibrary, recommendations,
    loading, qualityOptions, activeQualityOptionIds,
    audioLanguages, subtitleLanguages, download, blacklisted, refreshDbData,
  } = useMediaDetailData(id, type);

  useEffect(() => {
    if (loading || (media && String(media.id) !== id)) return;
    // Don't steal focus if the person used the header while waiting for the fetch.
    if (document.activeElement === document.body || document.activeElement?.id === 'media-detail-loading') {
      document.getElementById('media-title')?.focus({ preventScroll: true });
    }
  }, [loading, media, id, type]);

  const {
    requesting, justRequested, requestError,
    selectedQuality, setSelectedQuality,
    selectedCriteria, setSelectedCriteria,
    searchMissingState, searchMissingError,
    handleRequest, handleSearchMissing,
    resetOnNavigation,
  } = useMediaRequestActions(media, id, type, refreshDbData);


  // Reset local UI state on navigation
  useEffect(() => {
    setRevealed(false);
    setShowNsfwModal(false);
    resetOnNavigation();
  }, [id, type]);

  const { isAvailable, takenQualityIds, buttonState } = useMediaAvailability({
    dbMedia,
    type,
    inLibrary,
    isDownloading: !!download,
    blacklisted: blacklisted?.blocked ?? false,
    activeQualityOptionIds,
    selectedQuality,
    searchMissingState,
    hasRequestableSeasons: type === 'tv' && !!media?.seasons
      && hasRequestableSeasons(media.seasons, sonarrSeasons),
    currentUserId: user?.id,
  });

  if (loading) {
    return <MediaDetailLoading />;
  }

  if (!media) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="text-ndp-text-muted">{t('media.not_found')}</p>
      </div>
    );
  }

  const nsfw = !revealed && isNsfw(media.id);

  const { title, year, genres, trailer, cast, director } = mediaSummary(media);

  return (
    <div className="min-h-dvh">
      <section className="media-detail-hero" aria-labelledby="media-title">
        <MediaBackdrop backdropPath={media.backdrop_path} posterPath={media.poster_path} blurred={nsfw} />
        <button onClick={() => navigate(-1)} aria-label={t('common.back')} className="absolute top-20 left-4 sm:left-8 z-20 p-2 glass rounded-xl hover:bg-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-ndp-accent">
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>

        <div className="media-detail-container relative z-10">
          <div className="media-detail-copy">
            {nsfw && (
              <button onClick={() => setShowNsfwModal(true)} className="btn-secondary inline-flex items-center gap-2 mb-6">
                <EyeOff className="w-4 h-4" />
                {t('nsfw.modal.show_once')}
              </button>
            )}
            <MediaInfoColumn
              onBrowseSeasons={type === 'tv' && media.seasons?.some(season => season.season_number > 0) ? () => {
                const section = document.getElementById('season-explorer');
                section?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
                section?.focus({ preventScroll: true });
              } : undefined}
              media={media}
              dbMedia={dbMedia}
              type={type}
              title={title}
              year={year}
              genres={genres}
              director={director}
              trailer={trailer}
              isAvailable={isAvailable}
              buttonState={buttonState}
              requesting={requesting}
              justRequested={justRequested}
              requestError={requestError}
              download={download ? { progress: download.progress, timeLeft: download.timeLeft } : null}
              blacklisted={blacklisted}
              searchMissingError={searchMissingError}
              onRequest={handleRequest}
              onSearchMissing={handleSearchMissing}
              qualityOptions={qualityOptions}
              takenQualityIds={takenQualityIds}
              selectedQuality={selectedQuality}
              selectedCriteria={selectedCriteria}
              setSelectedCriteria={setSelectedCriteria}
              setSelectedQuality={setSelectedQuality}
              audioLanguages={audioLanguages}
              subtitleLanguages={subtitleLanguages}
            />
          </div>
        </div>
      </section>

      {type === 'tv' && media.seasons?.some(season => season.season_number > 0) && (
        <div className="media-detail-seasons">
          <SeasonExplorer key={media.id} media={media} seasons={media.seasons}
            sonarrSeasons={sonarrSeasons} requests={dbMedia?.requests ?? []}
            qualityOptions={qualityOptions} activeQualityOptionIds={activeQualityOptionIds}
            blocked={blacklisted.blocked} blurred={nsfw} onRefresh={refreshDbData} />
        </div>
      )}

      <div className="media-detail-container relative pb-16">
        {/* Collection */}
        {type === 'movie' && media.belongs_to_collection && (
          <CollectionSection collection={media.belongs_to_collection} />
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <CastSection cast={cast} title={t('media.casting')} director={director} />
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="mt-12 -mx-4 sm:-mx-8">
            <MediaRow title={t('media.recommendations')} media={recommendations} size="large" />
          </div>
        )}
      </div>

      {showNsfwModal && (
        <NsfwRevealModal
          contentRating={dbMedia?.contentRating || ''}
          onRevealOnce={() => { setRevealed(true); setShowNsfwModal(false); }}
          onRevealAlways={() => { disableBlur(); setShowNsfwModal(false); }}
          onClose={() => setShowNsfwModal(false)}
        />
      )}
    </div>
  );
}

// ─── Cast Section ───────────────────────────────────────────────────

function CastSection({ cast, title, director }: Readonly<{ cast: TmdbCast[]; title: string; director?: TmdbCrew }>) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <div className="mt-12 relative group/cast">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="text-xl font-bold text-ndp-text">{title}</h2>
        {director && (
          <Link to={`/person/${director.id}`} className="flex items-center gap-1.5 text-sm text-ndp-text-muted hover:text-ndp-accent transition-colors">
            <span className="text-ndp-text-dim">·</span>
            <Clapperboard className="w-3.5 h-3.5" />
            <span className="font-medium">{director.name}</span>
          </Link>
        )}
      </div>

      <button
        onClick={() => scroll('left')}
        aria-label={t('common.previous')}
        className="absolute left-0 top-12 bottom-0 z-20 w-10 bg-gradient-to-r from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/cast:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <ChevronLeft className="w-5 h-5 text-white" />
      </button>
      <button
        onClick={() => scroll('right')}
        aria-label={t('common.next')}
        className="absolute right-0 top-12 bottom-0 z-20 w-10 bg-gradient-to-l from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/cast:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <ChevronRight className="w-5 h-5 text-white" />
      </button>

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {cast.map((person, i) => (
          <Link
            to={`/person/${person.id}`}
            key={person.id}
            className="flex-shrink-0 w-[120px] group/card"
            style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
          >
            <div className="relative aspect-square rounded-full overflow-hidden bg-ndp-surface-light ring-1 ring-white/10">
              {person.profile_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
                  alt={person.name}
                  className="w-full h-full object-cover object-[center_20%] transition-transform duration-300 group-hover/card:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-ndp-surface-light to-ndp-bg">
                  <User className="w-10 h-10 text-ndp-text-dim/30" />
                </div>
              )}
            </div>
              <div className="pt-3 px-1 text-center">
                <p className="text-xs font-semibold text-ndp-text leading-snug">{person.name}</p>
                {person.character && (
                  <p className="text-[11px] text-ndp-text-muted leading-snug mt-1">{person.character}</p>
                )}
              </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

