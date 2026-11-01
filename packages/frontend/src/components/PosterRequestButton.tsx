import type { MouseEventHandler } from 'react';
import { Loader2, Plus } from 'lucide-react';

/** Shared quick-request control for portal posters and season covers. */
export function PosterRequestButton({ label, onClick, loading = false }: Readonly<{
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  loading?: boolean;
}>) {
  return <button type="button" onClick={onClick} disabled={loading}
    className="absolute top-2 right-2 p-1.5 bg-ndp-accent rounded-full hover:bg-ndp-accent/80 transition-colors shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ndp-accent-hover [@media(hover:none)]:opacity-100 z-10"
    title={label} aria-label={label}>
    {loading ? <Loader2 className="w-4 h-4 text-white animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4 text-white" aria-hidden="true" />}
  </button>;
}
