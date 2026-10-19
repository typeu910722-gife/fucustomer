import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1200,
    // three.js in its own long-cached chunk; game updates don't re-download it
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes('node_modules/three/') ? 'three' : undefined) } },
  },
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
});
