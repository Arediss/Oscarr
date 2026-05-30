import { createMediaServerProvider } from '../mediaServerProvider.js';

export const embyProvider = createMediaServerProvider({ id: 'emby', label: 'Emby', icon: '/providers/emby.png' });
