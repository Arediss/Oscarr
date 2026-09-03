import axios from 'axios';
import type { Provider } from '../types.js';
import { trimTrailingSlashes } from '../../utils/trimTrailingSlashes.js';

export const jackettProvider: Provider = {
  service: {
    id: 'jackett',
    label: 'Jackett',
    icon: '/providers/jackett.svg',
    category: 'indexer',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:9117' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const baseUrl = trimTrailingSlashes(config.url ?? '');
      const apiKey = config.apiKey ?? '';

      // Torznab caps endpoint accepts the apikey (whereas /server/config and /indexers require
      // cookie auth when Jackett's admin password is set — locking out apikey-only callers).
      const { data, status } = await axios.get<string>(
        `${baseUrl}/api/v2.0/indexers/all/results/torznab/api`,
        {
          timeout: 5000,
          params: { apikey: apiKey, t: 'caps' },
          headers: { Accept: 'application/xml' },
          responseType: 'text',
          transformResponse: [(d) => d],
          maxRedirects: 0,
          validateStatus: (s) => s === 200,
        },
      );

      if (status !== 200 || !/server\s+title\s*=\s*["']Jackett["']/i.test(String(data))) {
        throw new Error('AUTH_FAILED');
      }
      return { ok: true };
    },
  },
};
