import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import MediaBackButton from './MediaBackButton';
import './media-detail.css';

/** Shared by the lazy route and its data fetch, so the page shell is available at click time. */
export default function MediaDetailLoading() {
  const { t } = useTranslation();
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body) status.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="min-h-dvh" aria-busy="true">
      <section className="media-detail-hero">
        <MediaBackButton />
        <div className="media-detail-art" aria-hidden="true">
          <div className="media-detail-image bg-ndp-surface/40"><div className="media-detail-shade" /></div>
        </div>
        <div className="media-detail-container relative z-10">
          <div className="media-detail-copy">
            <p ref={status} id="media-detail-loading" role="status" tabIndex={-1} className="text-sm text-ndp-text-muted outline-none">{t('common.loading')}</p>
            <div aria-hidden="true" className="space-y-5 mt-6">
              <div className="skeleton motion-reduce:animate-none h-14 w-3/4" />
              <div className="skeleton motion-reduce:animate-none h-4 w-1/2" />
              <div className="space-y-3 py-4">
                <div className="skeleton motion-reduce:animate-none h-4 w-full" />
                <div className="skeleton motion-reduce:animate-none h-4 w-full" />
                <div className="skeleton motion-reduce:animate-none h-4 w-2/3" />
              </div>
              <div className="skeleton motion-reduce:animate-none h-11 w-44" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
