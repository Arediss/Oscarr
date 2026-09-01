import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Oscarr',
        short_name: 'Oscarr',
        description:
          'Media request management for Plex, Jellyfin, Radarr & Sonarr',
        theme_color: '#0a0e17',
        background_color: '#0a0e17',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/logo.png',
            sizes: 'any',
            type: 'image/png',
          },
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        importScripts: ['/sw-push.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // No skipWaiting: a new worker waits until the person accepts the update banner
        // (main.tsx → registerSW.onNeedRefresh). Taking over immediately meant an open tab was
        // running one build's JavaScript against another build's precached assets, so main.tsx
        // reloaded every tab on the spot to resync — discarding whatever was being typed.
        // clientsClaim stays: it only matters on the very first install, where there is no
        // previous build to disagree with.
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/image\.tmdb\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tmdb-images',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
        ws: true,
        // Forward x-forwarded-* so the backend can resolve Oscarr's public URL correctly
        // (e.g. OAuth callback URL must point at :5173 where the browser actually is, not
        // at the proxy target :3456).
        xfwd: true,
      },
    },
  },
});
