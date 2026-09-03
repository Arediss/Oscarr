import axios from 'axios';
import type { Provider } from '../types.js';
import { trimTrailingSlashes } from '../../utils/trimTrailingSlashes.js';

export const qbittorrentProvider: Provider = {
  service: {
    id: 'qbittorrent',
    label: 'qBittorrent',
    icon: '/providers/qbittorrent.svg',
    category: 'download-client',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:8080' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const baseUrl = trimTrailingSlashes(config.url ?? '');
      const apiKey = config.apiKey ?? '';

      const res = await axios.get<string>(`${baseUrl}/api/v2/app/version`, {
        timeout: 5000,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Referer: baseUrl,
        },
        responseType: 'text',
        transformResponse: [(data) => data],
        validateStatus: () => true,
      });

      if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED');
      if (res.status !== 200) throw new Error('AUTH_FAILED');

      const body = String(res.data).trim();
      if (!/^v?\d/i.test(body)) throw new Error('AUTH_FAILED');

      return { ok: true, version: body.replace(/^v/i, '') };
    },
  },
};
