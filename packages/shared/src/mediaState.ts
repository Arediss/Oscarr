// Closed business enum. Customisable MediaStateOption.key values map to one of these.
export const MEDIA_STATE_CATEGORIES = [
  'UNAVAILABLE',
  'PENDING_DECISION',
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

export function isColorToken(value: unknown): value is ColorToken {
  return typeof value === 'string' && (COLOR_TOKENS as readonly string[]).includes(value);
}

export function isIconName(value: unknown): value is IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value);
}
