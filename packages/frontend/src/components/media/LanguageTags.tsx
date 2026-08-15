import { useTranslation } from 'react-i18next';

interface Props {
  audioLanguages: string[];
  subtitleLanguages: string[];
}

function TagGroup({ title, langs }: Readonly<{ title: string; langs: string[] }>) {
  if (langs.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-ndp-text-muted uppercase tracking-wider mb-3">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {langs.map((lang) => (
          <span key={lang} className="px-3 py-1.5 bg-white/5 rounded-xl text-sm font-medium text-ndp-text border border-white/5">
            {lang}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Audio and subtitle tracks reported by the *arr. Renders nothing when neither is known — an
 *  empty heading reads as "no subtitles" rather than "not scanned yet". */
export function LanguageTags({ audioLanguages, subtitleLanguages }: Readonly<Props>) {
  const { t } = useTranslation();
  if (audioLanguages.length === 0 && subtitleLanguages.length === 0) return null;

  return (
    <div className="mt-6 flex flex-wrap gap-6">
      <TagGroup title={t('media.audio_languages')} langs={audioLanguages} />
      <TagGroup title={t('media.subtitle_languages')} langs={subtitleLanguages} />
    </div>
  );
}
