import { useTranslation } from 'react-i18next';

interface Props {
  audioLanguages: string[];
  subtitleLanguages: string[];
  loading: boolean;
}

function TagGroup({ title, langs, loading }: Readonly<{ title: string; langs: string[]; loading: boolean }>) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-ndp-text-muted uppercase tracking-wider mb-3">{title}</h3>
      <div className="media-language-values flex h-12 gap-2 overflow-x-auto overflow-y-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ndp-accent"
        role={langs.length ? 'list' : undefined} aria-label={langs.length ? title : undefined} tabIndex={langs.length ? 0 : undefined}>
        {loading ? <span className="skeleton motion-reduce:animate-none h-9 w-24 shrink-0" aria-hidden="true" />
          : langs.length === 0 ? <span className="flex h-9 items-center text-sm text-ndp-text-muted">{t('media.languages_unknown')}</span>
          : langs.map((lang) => (
          <span key={lang} role="listitem" className="h-9 shrink-0 whitespace-nowrap px-3 py-1.5 bg-white/5 rounded-xl text-sm font-medium text-ndp-text border border-white/5">
            {lang}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Reserve both groups before the asynchronous scan; unknown tracks never mean no tracks. */
export function LanguageTags({ audioLanguages, subtitleLanguages, loading }: Readonly<Props>) {
  const { t } = useTranslation();

  return (
    <div className="media-language-tags mt-6 grid grid-cols-2 gap-6" aria-busy={loading}>
      {loading && <span role="status" className="sr-only">{t('common.loading')}</span>}
      <TagGroup title={t('media.audio_languages')} langs={audioLanguages} loading={loading} />
      <TagGroup title={t('media.subtitle_languages')} langs={subtitleLanguages} loading={loading} />
    </div>
  );
}
