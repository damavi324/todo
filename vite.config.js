import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { VitePWA } from 'vite-plugin-pwa'

// `vite build --mode android` builds the copy bundled into the Android app. Its files load from the APK,
// where a caching service worker can only serve an outdated build after an update, so that build ships a
// worker that clears the old cache and unregisters itself.
export default defineConfig(({ mode }) => ({
  build: {
    // Android emulator WebViews can be far behind desktop Chrome.
    target: 'es2018',
  },
  plugins: [
    react(),
    legacy({
      targets: ['Chrome >= 83', 'Android >= 10'],
      modernPolyfills: true,
    }),
    VitePWA({
      registerType: 'autoUpdate',
      selfDestroying: mode === 'android',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'ToDo',
        short_name: 'ToDo',
        description: 'Modern task manager with Google Calendar sync',
        theme_color: '#4772FA',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      devOptions: { enabled: true },
    }),
  ],
}))
