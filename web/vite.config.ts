import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import wasm from 'vite-plugin-wasm';
import path from 'path';

export default defineConfig({
  plugins: [preact(), wasm()],
  root: '.',
  base: './',
  server: {
    port: 5173,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: true,
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@pi-oxide/web-js': path.resolve(__dirname, '../crates/web-js/js/index.ts'),
      '@pi-oxide/extension-js': path.resolve(__dirname, '../crates/extension-js/js/src/main/index.ts'),
      '@pi-oxide/dom-semantic-tree': path.resolve(__dirname, '../crates/dom-semantic-tree/js/index.ts'),
    },
  },
});
