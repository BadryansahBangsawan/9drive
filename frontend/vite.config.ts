import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// `--mode desktop` builds the app for the Tauri shell (desktop/): no PWA/service worker, its own
// output folder, and VITE_DESKTOP=1 from .env.desktop.
export default defineConfig(({ mode }) => ({
  build: mode === 'desktop' ? { outDir: 'dist-desktop', emptyOutDir: true } : undefined,
  // The Tauri dev server URL is fixed in desktop/src-tauri/tauri.conf.json.
  server: mode === 'desktop' ? { port: 1420, strictPort: true } : undefined,
  clearScreen: mode === 'desktop' ? false : undefined,
  plugins: [
    react(),
    mode !== 'desktop' && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: '9Drive',
        short_name: '9Drive',
        description: 'Google Drive storage gateway for files, folders, sharing, and quota tracking.',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/all-files',
        scope: '/',
        orientation: 'portrait-primary',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Production serves the backend under /api (nginx proxy); the bare prefixes cover dev/custom VITE_API_URL setups.
        navigateFallbackDenylist: [/^\/api\//, /^\/(auth|api-keys|audit-logs|connected-accounts|files|folders|invites|provider-configs|public|storage|system|uploads)(\/|$)/],
        globPatterns: ['**/*.{js,css,html,svg,ico,png,webp,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: [
      // Web builds get a stub, so no Tauri code ships to browsers.
      { find: /^@\/lib\/desktop$/, replacement: path.resolve(__dirname, mode === 'desktop' ? './src/lib/desktop.ts' : './src/lib/desktop-web.ts') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
}))
