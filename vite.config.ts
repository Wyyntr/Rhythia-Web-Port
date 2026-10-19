import { defineConfig } from 'vitest/config';

/**
 * GitHub Pages serves project sites from a subpath (`/<repo>/`), so production
 * builds default to `/rhythia-web/`. Override with BASE_PATH when deploying
 * somewhere else (for example `BASE_PATH=/ pnpm build` for a custom domain).
 */
export default defineConfig(({ mode }) => ({
  // `vite build` and `vite preview` both run in production mode; keep the
  // GitHub Pages subpath there so previews match the deployed site.
  base: process.env.BASE_PATH ?? (mode === 'production' ? '/rhythia-web/' : '/'),
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
