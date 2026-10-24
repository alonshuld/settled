import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

// Dev: the API has no CORS, so the browser talks to it same-origin through this proxy
// (production does the same with a host-level /api rewrite).
export default defineConfig({
  // vite-plus bundles its own vite types, so the plugin types from this package's vite don't line up.
  plugins: [react(), tailwindcss()] as never,
  // @settled/core is CommonJS; pre-bundle it so the dev server serves it as ESM with named exports.
  optimizeDeps: { include: ['@settled/core'] },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['./src/test-setup.ts'] },
  server: {
    port: 3000,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false } },
  },
});
