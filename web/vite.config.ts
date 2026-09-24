import { defineConfig } from 'vite';

// Relative base: the built game works from any sub-path (e.g. scaffolde.ai/snake/) or a plain static host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
