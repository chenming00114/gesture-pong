import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), pong: resolve(__dirname, 'pong.html'), tester: resolve(__dirname, 'tester.html') } } },
});
