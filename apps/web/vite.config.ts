import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        importScripts: ['push-handler.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health$/],
      },
      manifest: {
        id: '/',
        name: 'Mighty & Cringe',
        short_name: 'M&C',
        description: 'Твой офлайн-first помощник для силовых тренировок.',
        theme_color: '#f5f6f8',
        background_color: '#f5f6f8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'ru',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
