import axios from 'axios';
import type { Provider } from '../types.js';

export const delugeProvider: Provider = {
  service: {
    id: 'deluge',
    label: 'Deluge',
    icon: '/providers/deluge.svg',
    category: 'download-client',
    fields: [
      { key: 'url', labelKey: 'common.url', type: 'text', placeholder: 'http://localhost:8112' },
      { key: 'password', labelKey: 'common.password', type: 'password' },
    ],
    async test(config) {
      const baseUrl = config.url?.replace(/\/+$/, '') ?? '';
      const password = config.password ?? '';

      const url = `${baseUrl}/json`;
      const loginRes = await axios.post<{ result?: boolean }>(
        url,
        { method: 'auth.login', params: [password], id: 1 },
        { timeout: 5000, validateStatus: (s) => s === 200 },
      );

      if (loginRes.data?.result !== true) throw new Error('AUTH_FAILED');

      const setCookie = loginRes.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie)
        ? setCookie.map((c) => c.split(';')[0]).join('; ')
        : '';
      if (!cookieHeader.includes('_session_id=')) throw new Error('AUTH_NO_SESSION');

      // Deluge Web is a thin shell over the daemon — the login can succeed while no daemon
      // is connected (fresh install, daemon down). Surface that as its own code so the UI
      // can tell admins to attach a daemon, not retype the password.
      const connectedRes = await axios.post<{ result?: boolean }>(
        url,
        { method: 'web.connected', params: [], id: 2 },
        {
          timeout: 5000,
          headers: { Cookie: cookieHeader },
          validateStatus: (s) => s === 200,
        },
      );

      if (connectedRes.data?.result !== true) throw new Error('DELUGE_DAEMON_DETACHED');
      return { ok: true };
    },
  },
};
