import axios from 'axios';
import type { Provider } from '../types.js';

export const nzbgetProvider: Provider = {
  service: {
    id: 'nzbget',
    label: 'NZBGet',
    icon: '/providers/nzbget.svg',
    category: 'download-client',
    untested: true,
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:6789' },
      { key: 'username', labelKey: 'common.username', type: 'text' },
      { key: 'password', labelKey: 'common.password', type: 'password' },
    ],
    async test(config) {
      const baseUrl = config.url?.replace(/\/+$/, '') ?? '';
      const username = config.username ?? '';
      const password = config.password ?? '';

      const { data } = await axios.post<{ result?: unknown; error?: { message?: string } | null }>(
        `${baseUrl}/jsonrpc`,
        { method: 'version', params: [], id: 1 },
        {
          timeout: 5000,
          auth: { username, password },
          validateStatus: (s) => s === 200,
        },
      );

      if (data.error || typeof data.result !== 'string') {
        throw new Error('AUTH_FAILED');
      }
      return { ok: true, version: data.result };
    },
  },
};
