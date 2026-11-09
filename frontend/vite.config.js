import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './'  -> build Electron (file://) aur website dono mein chale
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/downloads': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true }
    }
  },
  build: { chunkSizeWarningLimit: 1200 }
});
