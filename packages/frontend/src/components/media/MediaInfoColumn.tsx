import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { PluginSlot } from '@/plugins/PluginSlot';
import ActionButton from '@/components/ActionButton';
import { MediaMetaBar } from '@/components/media/MediaMetaBar';
import { QualityPicker } from '@/components/media/QualityPicker';
import CriteriaPicker from './CriteriaPicker';
import { LanguageTags } from '@/components/media/LanguageTags';
import { SeasonsPicker } from '@/components/media/SeasonsPicker';
import type { ButtonState } from '@/utils/resolveButtonState';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface Props {
  media: Record<string, any>;
  dbMedia: Record<string, any> | null;
  type: 'movie' | 'tv';
  title: string;
  year: string;
  genres?: string;
  director?: { name: string };
  trailer?: { key: string };
  isAvailable: boolean;
  userHasRequest: boolean;
  buttonState: ButtonState;
  requesting: boolean;
  justRequested: boolean;
  requestError: string | null;
  download: { progress: number; timeLeft: string } | null;
  blacklisted: { reason?: string | null } | null;
  searchMissingError?: string;
  onRequest: () => void;
  onSearchMissing: () => void;
  qualityOptions: { id: number; label: string }[];
  selectedCriteria: Record<number, number>;
  setSelectedCriteria: (next: Record<number, number>) => void;
  takenQualityIds: Set<number>;
  selectedQuality: number | null;
  setSelectedQuality: (updater: (prev: number | null) => number | null) => void;
  audioLanguages: string[];
  subtitleLanguages: string[];
  sonarrSeasons: { seasonNumber: number; episodeFileCount: number; totalEpisodeCount: number }[];
  selectedSeasons: number[];
  setSelectedSeasons: (updater: (prev: number[]) => number[]) => void;
  onOpenEpisodes: () => void;
}

/** Everything shown beside the poster: title, facts, synopsis, actions and request options. */
export function MediaInfoColumn({
  media, dbMedia, type, title, year, genres, director, trailer,
  isAvailable, userHasRequest, buttonState,
  requesting, justRequested, requestError, download, blacklisted, searchMissingError,
  onRequest, onSearchMissing,
  qualityOptions, takenQualityIds, selectedQuality, setSelectedQuality,
  selectedCriteria, setSelectedCriteria,
  audioLanguages, subtitleLanguages,
  sonarrSeasons, selectedSeasons, setSelectedSeasons, onOpenEpisodes,
}: Readonly<Props>) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  // Deep link into the plugin that manages this title. Only rendered when the media is actually
  // tracked by an *arr and the viewer can reach the admin area — a dead link is worse than none.
  const arrPlugin = type === 'movie'
    ? (dbMedia?.radarrId ? { id: 'radarr', param: 'movieId', value: dbMedia.radarrId, label: t('media.open_in_radarr') } : null)
    : (dbMedia?.sonarrId ? { id: 'sonarr', param: 'seriesId', value: dbMedia.sonarrId, label: t('media.open_in_sonarr') } : null);

  return (
      <div className="flex-1 min-w-0">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white">{title}</h1>

        {media.tagline && (
          <p className="text-ndp-text-muted italic mt-2">{media.tagline}</p>
        )}

        <MediaMetaBar
          year={year}
          runtime={media.runtime}
          voteAverage={media.vote_average}
          voteCount={media.vote_count}
          numberOfSeasons={media.number_of_seasons}
          type={type}
          genres={genres}
        />

        {/* Synopsis */}
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-ndp-text-muted uppercase tracking-wider mb-2">{t('media.synopsis')}</h3>
          <p className="text-ndp-text leading-relaxed">{media.overview || t('media.no_description')}</p>

          {/* Plugin hook: media detail info */}
          <PluginSlot hookPoint="media.detail.info" context={{ media, type, dbMedia }} />
        </div>

        {/* Director */}
        {director && (
          <p className="mt-4 text-sm text-ndp-text-muted">
            {t('media.directed_by', { name: director.name })}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-3 mt-8">
          {trailer && (
            <a
              href={`https://www.youtube.com/watch?v=${trailer.key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              {t('media.trailer')}
            </a>
          )}

          <ActionButton
            state={buttonState}
            requesting={requesting}
            justRequested={justRequested}
            download={download}
            searchMissingError={searchMissingError}
            blacklistReason={blacklisted?.reason ?? undefined}
            onRequest={onRequest}
            onSearchMissing={onSearchMissing}
            t={t}
          />

          {/* Request error message */}
          {requestError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ndp-danger/10 border border-ndp-danger/20 text-ndp-danger text-sm animate-fade-in">
              {requestError}
            </div>
          )}

          {/* Plugin hook: media detail actions */}
          <PluginSlot hookPoint="media.detail.actions" context={{ media, type, isAvailable, dbMedia }} />
        </div>

        <QualityPicker
          options={qualityOptions}
          takenIds={takenQualityIds}
          selected={selectedQuality}
          onSelect={setSelectedQuality}
        />

        <CriteriaPicker
          selected={selectedCriteria}
          onSelect={(criterionId, valueId) => {
            const next = { ...selectedCriteria };
            if (valueId === null) delete next[criterionId];
            else next[criterionId] = valueId;
            setSelectedCriteria(next);
          }}
        />

        {/* What is actually on disk, read from the file after import. Descriptive, not a choice —
            the pickers above are the choices. */}
        <LanguageTags audioLanguages={audioLanguages} subtitleLanguages={subtitleLanguages} />


        {/* Seasons */}
        {type === 'tv' && media.seasons && media.seasons.length > 0 && (
          <SeasonsPicker
            seasons={media.seasons}
            sonarrSeasons={sonarrSeasons}
            selectedSeasons={selectedSeasons}
            setSelectedSeasons={setSelectedSeasons}
            canSelect={!userHasRequest}
            onOpenDetails={onOpenEpisodes}
          />
        )}

      </div>
  );
}
