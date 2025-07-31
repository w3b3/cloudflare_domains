import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Allow all hosts
    proxy: {
      '/api': {
        target: 'http://api:3333',
        changeOrigin: true,
      },
      '/screenshots': {
        target: 'http://api:3333',
        changeOrigin: true,
      }
    }
  }
}); 