import axios from 'axios';
import type { Provider } from '../types.js';

export const sabnzbdProvider: Provider = {
  service: {
    id: 'sabnzbd',
    label: 'SABnzbd',
    icon: '/providers/sabnzbd.svg',
    category: 'download-client',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:8080' },
      { key: 'apiKey', labelKey: 'common.api_key', type: 'password' },
    ],
    async test(config) {
      const baseUrl = config.url?.replace(/\/+$/, '') ?? '';
      const apiKey = config.apiKey ?? '';

      // SAB returns 200 even on bad keys — the body carries `{ "error": "API Key Required" }`.
      // The XML default is on, so always force `output=json`.
      const { data } = await axios.get<{ version?: string; error?: string }>(
        `${baseUrl}/api`,
        {
          timeout: 5000,
          params: { mode: 'version', apikey: apiKey, output: 'json' },
          validateStatus: (s) => s === 200,
        },
      );

      if (data.error || typeof data.version !== 'string') {
        throw new Error('AUTH_FAILED');
      }
      return { ok: true, version: data.version };
    },
  },
};
