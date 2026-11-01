import { clsx } from 'clsx';
import { useId } from 'react';
import { posterUrl, backdropUrl } from '@/lib/api';

/** Center artwork in the visible right-hand area, then blend it into the page. */
export function MediaBackdrop({ backdropPath, posterPath, blurred }: Readonly<{
  backdropPath?: string | null;
  posterPath?: string | null;
  blurred: boolean;
}>) {
  const veilId = useId();
  return (
    <div className="media-detail-art" aria-hidden="true">
      {(backdropPath || posterPath) && (
        <div className="media-detail-image">
          <img
            src={backdropPath ? backdropUrl(backdropPath) : posterUrl(posterPath ?? null)}
            alt=""
            className={clsx('w-full h-full object-center', backdropPath ? 'object-cover' : 'object-contain', blurred && 'blur-3xl scale-110')}
          />
          <svg className="media-detail-veil" viewBox="0 0 1200 900" preserveAspectRatio="none" focusable="false">
            <defs>
              <filter id={veilId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
                <feGaussianBlur stdDeviation="96" />
              </filter>
            </defs>
            {/* Overlapping, feathered contours keep the artwork open without a visible circular edge. */}
            <g fill="currentColor" filter={`url(#${veilId})`}>
              <path d="M-260-240H90C180 80 160 210 330 340S390 505 520 620S730 755 800 1140H-260Z" />
              <path fillOpacity=".6" d="M-260-180H-30C80 80 80 280 280 430S330 610 520 740S660 960 650 1140H-260Z" />
              <path fillOpacity=".94" d="M-200 660C40 580 155 760 410 740S690 655 850 775S1095 740 1400 850V1160H-200Z" />
              <path fillOpacity=".28" d="M-200-220H1400V-30C1060 85 900-40 650 25S240-15-200 100Z" />
            </g>
          </svg>
          <div className="media-detail-shade" />
        </div>
      )}
    </div>
  );
}
