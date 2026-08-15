import { clsx } from 'clsx';
import { EyeOff } from 'lucide-react';
import { posterUrl, backdropUrl } from '@/lib/api';

/** Full-bleed backdrop behind the page, fading to the page background as the reader scrolls. */
export function MediaBackdrop({ backdropPath, blurred, fadeOpacity }: Readonly<{
  backdropPath?: string | null;
  blurred: boolean;
  fadeOpacity: number;
}>) {
  return (
    <div className="fixed inset-0 h-dvh z-0">
      {backdropPath
        ? <img src={backdropUrl(backdropPath)} alt="" className={clsx('w-full h-full object-cover', blurred && 'blur-3xl scale-110')} />
        : <div className="w-full h-full bg-ndp-surface" />}
      <div className="absolute inset-0 bg-gradient-to-t from-ndp-bg via-ndp-bg/40 to-ndp-bg/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-ndp-bg/70 to-transparent" />
      {/* Scroll-driven fade to the background colour. */}
      <div className="absolute inset-0 bg-ndp-bg transition-none" style={{ opacity: fadeOpacity }} />
    </div>
  );
}

/** Poster, blurred behind a reveal affordance when the title is flagged mature. */
export function MediaPoster({ posterPath, title, blurred, onReveal }: Readonly<{
  posterPath: string | null;
  title: string;
  blurred: boolean;
  onReveal: () => void;
}>) {
  return (
    <div className="flex-shrink-0 w-48 sm:w-56 mx-auto md:mx-0">
      <div className="aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl shadow-black/50 ring-1 ring-white/10 relative">
        <img
          src={posterUrl(posterPath)}
          alt={title}
          className={clsx('w-full h-full object-cover', blurred && 'blur-xl scale-110')}
        />
        {blurred && (
          <button
            onClick={onReveal}
            className="absolute inset-0 flex items-center justify-center cursor-pointer group/nsfw"
          >
            <div className="p-3 rounded-full bg-black/30 backdrop-blur-sm shadow-lg shadow-black/30 group-hover/nsfw:bg-black/50 transition-colors">
              <EyeOff className="w-6 h-6 text-white/80 group-hover/nsfw:text-white transition-colors" />
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
