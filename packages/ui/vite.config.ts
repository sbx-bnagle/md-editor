import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // pagedjs' package exports hide its self-contained ESM build.
      'pagedjs-esm': resolve(here, '../../node_modules/pagedjs/dist/paged.esm.js'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: resolve(here, 'index.html'),
        preview: resolve(here, 'preview.html'),
        print: resolve(here, 'print.html'),
      },
    },
  },
});
