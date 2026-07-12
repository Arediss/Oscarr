import axios from 'axios';
import type { Provider } from '../types.js';
import { SonarrClient } from './client.js';

export const sonarrProvider: Provider = {
  service: {
    id: 'sonarr',
    label: 'Sonarr',
    icon: '/providers/sonarr.svg',
    category: 'arr',
    requiredForInstall: true,
    handlesMediaTypes: ['tv'],
    dbIdField: 'sonarrId',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:8989' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const { data } = await axios.get(`${config.url}/api/v3/system/status`, {
        params: { apikey: config.apiKey },
        timeout: 5000,
      });
      return { ok: true, version: data.version };
    },
    createClient(config) {
      return new SonarrClient(config.url || '', config.apiKey || '');
    },
  },
};

export { SonarrClient } from './client.js';
export type { SonarrSeries, SonarrSeason, SonarrQueueItem, SonarrEpisode, SonarrEpisodeFile, SonarrHistoryRecord } from './types.js';
