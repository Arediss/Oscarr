import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Star,
  Calendar,
  Clock,
  Check,
  Loader2,
  ArrowLeft,
  Tv,
  Film,
  Play,
  X,
  EyeOff,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  User,
  Clapperboard,
} from 'lucide-react';
import { clsx } from 'clsx';
import { posterUrl, backdropUrl } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useNsfwFilter } from '@/hooks/useNsfwFilter';
import MediaRow from '@/components/MediaRow';
import CollectionSection from '@/components/CollectionSection';
import { PluginSlot } from '@/plugins/PluginSlot';
import { useMediaDetailData } from '@/hooks/useMediaDetailData';
import { useMediaRequestActions } from '@/hooks/useMediaRequestActions';
import { useEpisodeModal } from '@/hooks/useEpisodeModal';
import type { TmdbCast, TmdbCrew } from '@/types';
import { ACTIVE_REQUEST_STATUSES } from '@oscarr/shared';
import { resolveButtonState } from '@/utils/resolveButtonState';
import ActionButton from '@/components/ActionButton';
import { SeasonsPicker } from '@/components/media/SeasonsPicker';
import { EpisodeDetailsModal } from '@/components/media/EpisodeDetailsModal';
import { LanguageTags } from '@/components/media/LanguageTags';
import { useMediaAvailability } from '@/hooks/useMediaAvailability';
import { MediaMetaBar } from '@/components/media/MediaMetaBar';
import { QualityPicker } from '@/components/media/QualityPicker';
import { NsfwRevealModal } from '@/components/media/NsfwRevealModal';
import { MediaInfoColumn } from '@/components/media/MediaInfoColumn';
import { MediaBackdrop, MediaPoster } from '@/components/media/MediaHeroArt';
import { mediaSummary } from '@/utils/mediaSummary';
import { hasRequestableSeasons } from '@/utils/seasonFill';

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
  const [scrollOpacity, setScrollOpacity] = useState(0);

  const handleScroll = useCallback(() => {
    const scrollY = window.scrollY;
    const fadeStart = 70;
    const fadeEnd = 375;
    const opacity = Math.min(1, Math.max(0, (scrollY - fadeStart) / (fadeEnd - fadeStart)));
    setScrollOpacity(opacity);
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const {
    media, dbMedia, sonarrSeasons, inLibrary, recommendations,
    loading, qualityOptions, activeQualityOptionIds,
    audioLanguages, subtitleLanguages, download, blacklisted, refreshDbData,
  } = useMediaDetailData(id, type);

  const {
    requesting, justRequested, requestError,
    selectedSeasons, setSelectedSeasons,
    selectedQuality, setSelectedQuality,
    searchMissingState, searchMissingError,
    handleRequest, handleSearchMissing,
    resetOnNavigation,
  } = useMediaRequestActions(media, id, type, refreshDbData);

  const {
    episodeModalOpen, openEpisodeModal, closeEpisodeModal,
    episodeCache, expandedSeason, loadingSeason, toggleSeason,
  } = useEpisodeModal(media?.id);

  // Reset local UI state on navigation
  useEffect(() => {
    setRevealed(false);
    setShowNsfwModal(false);
    resetOnNavigation();
  }, [id, type]);

  const { isAvailable, takenQualityIds, userHasRequest, buttonState } = useMediaAvailability({
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
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-ndp-accent animate-spin" />
      </div>
    );
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
      <MediaBackdrop backdropPath={media.backdrop_path} blurred={nsfw} fadeOpacity={scrollOpacity} />

      {/* Back button - fixed */}
      <button onClick={() => navigate(-1)} className="fixed top-20 left-4 sm:left-8 z-20 p-2 glass rounded-xl hover:bg-white/10 transition-colors">
        <ArrowLeft className="w-5 h-5 text-white" />
      </button>

      {/* Scrollable content */}
      <div className="relative z-10 pt-[35vh] min-h-dvh">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-8">
        <div className="flex flex-col md:flex-row gap-8">
          <MediaPoster
            posterPath={media.poster_path}
            title={title}
            blurred={nsfw}
            onReveal={() => setShowNsfwModal(true)}
          />

          {/* Info */}
          <MediaInfoColumn
            media={media}
            dbMedia={dbMedia}
            type={type}
            title={title}
            year={year}
            genres={genres}
            director={director}
            trailer={trailer}
            isAvailable={isAvailable}
            userHasRequest={userHasRequest}
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
            setSelectedQuality={setSelectedQuality}
            audioLanguages={audioLanguages}
            subtitleLanguages={subtitleLanguages}
            sonarrSeasons={sonarrSeasons}
            selectedSeasons={selectedSeasons}
            setSelectedSeasons={setSelectedSeasons}
            onOpenEpisodes={openEpisodeModal}
          />
        </div>

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
          <div className="mt-12 pb-16">
            <MediaRow title={t('media.recommendations')} media={recommendations} size="large" />
          </div>
        )}
        </div>
      </div>

      {/* Episode details modal */}
      {episodeModalOpen && media && (
        <EpisodeDetailsModal
          media={media}
          sonarrSeasons={sonarrSeasons}
          expandedSeason={expandedSeason}
          loadingSeason={loadingSeason}
          episodeCache={episodeCache}
          nsfw={nsfw}
          onToggleSeason={toggleSeason}
          onClose={closeEpisodeModal}
        />
      )}

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.75;
    scrollRef.current.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <div className="mt-12 relative group/cast">
      <div className="flex items-center gap-3 mb-4 sm:px-8">
        <h3 className="text-xl font-bold text-ndp-text">{title}</h3>
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
        className="absolute left-0 top-12 bottom-0 z-20 w-10 bg-gradient-to-r from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/cast:opacity-100 transition-opacity"
      >
        <ChevronLeft className="w-5 h-5 text-white" />
      </button>
      <button
        onClick={() => scroll('right')}
        className="absolute right-0 top-12 bottom-0 z-20 w-10 bg-gradient-to-l from-ndp-bg to-transparent flex items-center justify-center opacity-0 group-hover/cast:opacity-100 transition-opacity"
      >
        <ChevronRight className="w-5 h-5 text-white" />
      </button>

      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto px-4 sm:px-8 pb-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {cast.map((person, i) => (
          <Link
            to={`/person/${person.id}`}
            key={person.id}
            className="flex-shrink-0 w-[120px] group/card"
            style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
          >
            <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-ndp-surface-light">
              {person.profile_path ? (
                <img
                  src={`https://image.tmdb.org/t/p/w185${person.profile_path}`}
                  alt={person.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-ndp-surface-light to-ndp-bg">
                  <User className="w-10 h-10 text-ndp-text-dim/30" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-8 pb-2.5 px-2.5">
                <p className="text-xs font-semibold text-white leading-tight truncate">{person.name}</p>
                {person.character && (
                  <p className="text-[10px] text-ndp-text-muted leading-tight truncate mt-0.5">{person.character}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

