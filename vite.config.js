import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite pre-bundles this config with esbuild, so ESM syntax works even though the
// root package is CommonJS (the Node server uses require()).
//
// In dev: Vite serves the React app on :5173 and proxies the WebSocket (/ws) to
// the Node server on :3000. In production: `npm run build` emits web/dist, which
// the Node server serves directly (so the WS is same-origin).
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    // Pin the port: the server's WebSocket Origin allowlist expects :5173. If we
    // let Vite drift to 5174+ when 5173 is busy, the browser's Origin would be
    // rejected by verifyClient. Fail loudly instead so the cause is obvious.
    strictPort: true,
    open: true,
    proxy: {
      '/ws': { target: 'http://127.0.0.1:3000', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
