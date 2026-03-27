import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // Use || (not ??) so that empty string also falls back to the default.
  // loadEnv returns '' for VITE_API_URL= which ?? does NOT catch.
  const apiTarget = env.VITE_API_URL || 'http://localhost:3001';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',    // bind to all interfaces for Docker / VM access
      port: 5173,
      proxy: {
        // In development, proxy /api calls to the backend so CORS is not needed
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
