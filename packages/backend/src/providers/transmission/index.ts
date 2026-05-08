import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { Provider } from '../types.js';

export const transmissionProvider: Provider = {
  service: {
    id: 'transmission',
    label: 'Transmission',
    icon: '/providers/transmission.svg',
    category: 'download-client',
    untested: true,
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:9091' },
      { key: 'username', labelKey: 'common.username', type: 'text' },
      { key: 'password', labelKey: 'common.password', type: 'password' },
    ],
    async test(config) {
      const baseUrl = config.url?.replace(/\/+$/, '') ?? '';
      const username = config.username ?? '';
      const password = config.password ?? '';

      const url = `${baseUrl}/transmission/rpc`;
      const body = { method: 'session-get' };
      const baseOpts: AxiosRequestConfig = { timeout: 5000 };
      if (username || password) baseOpts.auth = { username, password };

      // Transmission's CSRF dance: the first POST returns 409 with a fresh
      // X-Transmission-Session-Id header that the client must echo on the retry.
      let res = await axios.post(url, body, {
        ...baseOpts,
        validateStatus: (s) => s === 200 || s === 409,
      });

      if (res.status === 409) {
        const sessionId = res.headers['x-transmission-session-id'];
        if (!sessionId) throw new Error('AUTH_NO_SESSION');
        res = await axios.post(url, body, {
          ...baseOpts,
          headers: { 'X-Transmission-Session-Id': String(sessionId) },
          validateStatus: (s) => s === 200,
        });
      }

      if (res.data?.result !== 'success') throw new Error('AUTH_FAILED');
      return { ok: true, version: res.data?.arguments?.version };
    },
  },
};
