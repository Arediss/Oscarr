// Closed canonical vocabulary. Each connector's resolveState produces one of these.
export const MEDIA_STATE_CATEGORIES = [
  'UNAVAILABLE',
  'UPCOMING',
  'SEARCHING',
  'PROCESSING',
  'AVAILABLE',
  'BLACKLISTED',
] as const;

export type MediaStateCategory = typeof MEDIA_STATE_CATEGORIES[number];

// Whitelisted to prevent admin XSS via raw classNames.
export const COLOR_TOKENS = ['accent', 'success', 'warning', 'danger', 'info', 'muted'] as const;
export type ColorToken = typeof COLOR_TOKENS[number];

export const ICON_NAMES = [
  'CheckCircle', 'Clock', 'Search', 'CalendarClock', 'Loader2',
  'AlertCircle', 'AlertTriangle', 'Ban', 'XCircle', 'HelpCircle',
  'Download', 'Film', 'Tv', 'Star', 'Bookmark', 'BookmarkX',
  'Eye', 'EyeOff', 'Lock', 'Unlock',
] as const;
export type IconName = typeof ICON_NAMES[number];

export const COLOR_TOKEN_CLASSES: Record<ColorToken, string> = {
  accent: 'bg-ndp-accent/80 text-white',
  success: 'bg-ndp-success/80 text-white',
  warning: 'bg-ndp-warning/80 text-white',
  danger: 'bg-ndp-danger/80 text-white',
  info: 'bg-purple-600/80 text-white',
  muted: 'bg-ndp-surface-light text-ndp-text-muted',
};

export function isMediaStateCategory(value: unknown): value is MediaStateCategory {
  return typeof value === 'string' && (MEDIA_STATE_CATEGORIES as readonly string[]).includes(value);
}

export interface MediaStateDisplay {
  /** i18n key, e.g. 'status.available'. */
  labelKey: string;
  colorToken: ColorToken;
  iconName: IconName;
  /** Default request-CTA policy for this category. */
  showsRequestCTA: boolean;
}

// One entry per category (the Record enforces exhaustiveness).
export const MEDIA_STATE_DISPLAY: Record<MediaStateCategory, MediaStateDisplay> = {
  UNAVAILABLE: { labelKey: 'status.unavailable', colorToken: 'muted',   iconName: 'HelpCircle',    showsRequestCTA: true  },
  UPCOMING:    { labelKey: 'status.upcoming',    colorToken: 'info',    iconName: 'CalendarClock', showsRequestCTA: false },
  SEARCHING:   { labelKey: 'status.searching',   colorToken: 'accent',  iconName: 'Search',        showsRequestCTA: false },
  PROCESSING:  { labelKey: 'status.processing',  colorToken: 'accent',  iconName: 'Loader2',       showsRequestCTA: false },
  AVAILABLE:   { labelKey: 'status.available',   colorToken: 'success', iconName: 'CheckCircle',   showsRequestCTA: false },
  BLACKLISTED: { labelKey: 'status.blocked',     colorToken: 'danger',  iconName: 'Ban',           showsRequestCTA: false },
};
