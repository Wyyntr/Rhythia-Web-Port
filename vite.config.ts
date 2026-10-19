import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub Pages serves project sites from a subpath (`/<repo>/`), so production
 * builds default to `/rhythia-web/`. Override with BASE_PATH when deploying
 * somewhere else (for example `BASE_PATH=/ pnpm build` for a custom domain).
 */
export default defineConfig(({ mode }) => ({
  // `vite build` and `vite preview` both run in production mode; keep the
  // GitHub Pages subpath there so previews match the deployed site.
  base: process.env.BASE_PATH ?? (mode === 'production' ? '/rhythia-web/' : '/'),
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Rhythia Web',
        short_name: 'Rhythia',
        description:
          'Unofficial browser port of Rhythia, a 3×3 aim rhythm game. Import your own maps and play offline.',
        lang: 'en',
        start_url: '.',
        theme_color: '#07080d',
        background_color: '#07080d',
        display: 'standalone',
        orientation: 'any',
        categories: ['games', 'entertainment'],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
