import {
  CheckCircle, Clock, Search, CalendarClock, Loader2, AlertCircle, AlertTriangle, Ban, XCircle,
  HelpCircle, Download, Film, Tv, Star, Bookmark, BookmarkX, Eye, EyeOff, Lock, Unlock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { MEDIA_STATE_DISPLAY, COLOR_TOKEN_CLASSES, type MediaStateCategory, type IconName } from '@oscarr/shared';

// keyed by IconName so a missing icon is a compile error, not a silent HelpCircle fallback
const ICONS: Record<IconName, LucideIcon> = {
  CheckCircle, Clock, Search, CalendarClock, Loader2, AlertCircle, AlertTriangle, Ban, XCircle,
  HelpCircle, Download, Film, Tv, Star, Bookmark, BookmarkX, Eye, EyeOff, Lock, Unlock,
};

export interface BadgeView {
  label: string;
  Icon: LucideIcon;
  badgeClass: string;
}

type T = (key: string) => string;

/** Visual presentation for a media category (source: MEDIA_STATE_DISPLAY). */
export function mediaStateDisplay(category: MediaStateCategory, t: T): BadgeView {
  // Guards an unknown value: statusCategory is cast from a DB string upstream.
  const d = MEDIA_STATE_DISPLAY[category] ?? MEDIA_STATE_DISPLAY.UNAVAILABLE;
  return { label: t(d.labelKey), Icon: ICONS[d.iconName] ?? HelpCircle, badgeClass: COLOR_TOKEN_CLASSES[d.colorToken] };
}

interface AvailabilityLike {
  statusCategory: MediaStateCategory;
  requestStatus?: string | null;
}

/** Combines media category + user request status into one badge.
 *  Precedence: AVAILABLE > active request > category. null = nothing to show. */
export function resolveDisplayState(
  availability: AvailabilityLike | null | undefined,
  t: T,
  mediaType?: string,
): BadgeView | null {
  if (!availability) return null;
  const { statusCategory: cat, requestStatus } = availability;
  if (cat === 'AVAILABLE') return mediaStateDisplay('AVAILABLE', t);
  if (cat === 'UNAVAILABLE') {
    if (requestStatus === 'pending') return { label: t('status.requested'), Icon: Clock, badgeClass: COLOR_TOKEN_CLASSES.warning };
    if (requestStatus === 'approved' || requestStatus === 'processing') return { label: t('status.processing'), Icon: Clock, badgeClass: COLOR_TOKEN_CLASSES.accent };
    if (requestStatus === 'failed') return { label: t('status.failed'), Icon: AlertTriangle, badgeClass: COLOR_TOKEN_CLASSES.danger };
    return null;
  }
  if (cat === 'PROCESSING' && mediaType === 'tv') return { label: t('status.partial'), Icon: Loader2, badgeClass: COLOR_TOKEN_CLASSES.accent };
  return mediaStateDisplay(cat, t);
}

/** Single badge used across all media surfaces. */
export function MediaStateBadge({ availability, mediaType, className }: {
  availability: AvailabilityLike | null | undefined;
  mediaType?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const view = resolveDisplayState(availability, t, mediaType);
  if (!view) return null;
  const { label, Icon, badgeClass } = view;
  return (
    <div className={clsx('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold', badgeClass, className)}>
      <Icon className="w-3 h-3" />
      {label}
    </div>
  );
}
