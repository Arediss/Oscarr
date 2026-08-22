import axios from 'axios';
import type { Provider } from '../types.js';
import { SonarrClient } from './client.js';

export const sonarrProvider: Provider = {
  service: {
    id: 'sonarr',
    label: 'Sonarr',
    icon: '/providers/sonarr.svg',
    category: 'arr',
    canConfirmAvailability: true,
    requiredForInstall: true,
    handlesMediaTypes: ['tv'],
    dbIdField: 'sonarrId',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:8989' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const { data } = await axios.get<{ appName?: string; version?: string }>(
        `${config.url}/api/v3/system/status`,
        { params: { apikey: config.apiKey }, timeout: 5000 },
      );
      // Radarr and Sonarr expose the same endpoint and both answer 200 with a valid key, so
      // without this a URL swapped between the two tested green and media routed to the wrong app.
      if (data.appName !== 'Sonarr') {
        throw new Error(`WRONG_APP:${data.appName ?? ''}:Sonarr`);
      }
      return { ok: true, version: data.version };
    },
    createClient(config) {
      return new SonarrClient(config.url || '', config.apiKey || '');
    },
  },
};

export { SonarrClient } from './client.js';
export type { SonarrSeries, SonarrSeason, SonarrQueueItem, SonarrEpisode, SonarrEpisodeFile, SonarrHistoryRecord } from './types.js';
