import { clsx } from 'clsx';
import { posterUrl, backdropUrl } from '@/lib/api';

/** Center artwork in the visible right-hand area, then blend it into the page. */
export function MediaBackdrop({ backdropPath, posterPath, blurred }: Readonly<{
  backdropPath?: string | null;
  posterPath?: string | null;
  blurred: boolean;
}>) {
  return (
    <div className="media-detail-art" aria-hidden="true">
      {(backdropPath || posterPath) && (
        <div className="media-detail-image">
          <img
            src={backdropPath ? backdropUrl(backdropPath) : posterUrl(posterPath ?? null)}
            alt=""
            className={clsx('w-full h-full object-center', backdropPath ? 'object-cover' : 'object-contain', blurred && 'blur-3xl scale-110')}
          />
        </div>
      )}
      <div className="media-detail-shade" />
      <div className="media-detail-bottom-fade" />
    </div>
  );
}
