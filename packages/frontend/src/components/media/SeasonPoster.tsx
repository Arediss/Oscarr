import { useState } from 'react';
import { Tv } from 'lucide-react';
import { posterUrl } from '@/lib/api';

export function SeasonPoster({ posterPath, seriesPosterPath, blurred = false }: Readonly<{
  posterPath: string | null;
  seriesPosterPath: string | null;
  blurred?: boolean;
}>) {
  const [failedPaths, setFailedPaths] = useState<string[]>([]);
  const path = [posterPath, seriesPosterPath].find(candidate => candidate && !failedPaths.includes(candidate));

  return <span className="season-poster-art">
    {path ? <img key={path} src={posterUrl(path, 'w342')} alt="" loading="lazy"
      className={`h-full w-full object-cover ${blurred ? 'blur-xl scale-110' : ''}`}
      onError={() => setFailedPaths(previous => [...previous, path])} />
      : <Tv size={40} className="text-ndp-text-dim" aria-hidden="true" />}
  </span>;
}
