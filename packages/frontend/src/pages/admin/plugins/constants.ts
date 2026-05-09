/** Registry entry shape returned by GET /plugins/registry — intentionally looser than the
 *  installed PluginInfo shape (no runtime state like `enabled` / `error` / `updateAvailable`,
 *  more marketing metadata like `stars` / `tags` / `category`). */
export interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description: string;
  author: string;
  repository: string;
  category: string;
  tags?: string[];
  url: string;
  stars: number;
  downloads?: number;
  updatedAt: string | null;
  services?: string[];
  capabilities?: string[];
  capabilityReasons?: Record<string, string>;
}

/** Display label only — chips render with a neutral pill style (was a per-category bg/text color
 *  palette, dropped to keep the cards visually calm). Unknown categories fall back to raw id. */
export const CATEGORY_CONFIG: Record<string, { label: string }> = {
  bots: { label: 'Bot' },
  notifications: { label: 'Notifications' },
  automation: { label: 'Automation' },
  'requests-workflow': { label: 'Requests' },
  subscriptions: { label: 'Subscriptions' },
  'ui-themes': { label: 'Themes' },
  analytics: { label: 'Analytics' },
  utilities: { label: 'Utilities' },
  support: { label: 'Support' },
};

/** Label + brand dot — chip is neutral, the small colored dot before the label keeps the brand
 *  identifiable at a glance without painting half the card. Unknown tags get no dot. */
export const TAG_CONFIG: Record<string, { label: string; dot?: string }> = {
  plex: { label: 'Plex', dot: '#e5a00d' },
  jellyfin: { label: 'Jellyfin', dot: '#aa5cc3' },
  emby: { label: 'Emby', dot: '#52b54b' },
  discord: { label: 'Discord', dot: '#5865f2' },
  telegram: { label: 'Telegram', dot: '#229ed9' },
  matrix: { label: 'Matrix', dot: '#0dbd8b' },
  slack: { label: 'Slack', dot: '#e01e5a' },
  radarr: { label: 'Radarr', dot: '#fbc935' },
  sonarr: { label: 'Sonarr', dot: '#35c5f0' },
};

export type SubTab = 'installed' | 'discover';
