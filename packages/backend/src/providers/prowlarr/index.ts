import axios from 'axios';
import type { Provider } from '../types.js';

export const prowlarrProvider: Provider = {
  service: {
    id: 'prowlarr',
    label: 'Prowlarr',
    icon: '/providers/prowlarr.svg',
    category: 'indexer',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:9696' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const baseUrl = config.url?.replace(/\/+$/, '') ?? '';
      const apiKey = config.apiKey ?? '';

      const { data } = await axios.get<{ appName?: string; version?: string }>(
        `${baseUrl}/api/v1/system/status`,
        {
          timeout: 5000,
          headers: { 'X-Api-Key': apiKey },
          validateStatus: (s) => s === 200,
        },
      );

      // Guard against the URL pointing at a different *arr (Radarr/Sonarr expose the same path
      // shape and would 200 with a matching key) — refuse anything that isn't Prowlarr.
      if (data.appName !== 'Prowlarr') {
        throw new Error('AUTH_FAILED');
      }
      return { ok: true, version: data.version };
    },
  },
};
