import axios from 'axios';
import type { Provider } from '../types.js';
import { RadarrClient } from './client.js';

export const radarrProvider: Provider = {
  service: {
    id: 'radarr',
    label: 'Radarr',
    icon: '/providers/radarr.svg',
    category: 'arr',
    canConfirmAvailability: true,
    requiredForInstall: true,
    handlesMediaTypes: ['movie'],
    dbIdField: 'radarrId',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:7878' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const { data } = await axios.get<{ appName?: string; version?: string }>(
        `${config.url}/api/v3/system/status`,
        { params: { apikey: config.apiKey }, timeout: 5000 },
      );
      // Radarr and Sonarr expose the same endpoint and both answer 200 with a valid key, so
      // without this a URL swapped between the two tested green and media routed to the wrong app.
      if (data.appName !== 'Radarr') {
        throw new Error(`WRONG_APP:${data.appName ?? ''}:Radarr`);
      }
      return { ok: true, version: data.version };
    },
    createClient(config) {
      return new RadarrClient(config.url || '', config.apiKey || '');
    },
  },
};

export { RadarrClient } from './client.js';
export type { RadarrMovie, RadarrQueueItem, RadarrHistoryRecord } from './types.js';
