import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  base: './',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1200 },
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
});
