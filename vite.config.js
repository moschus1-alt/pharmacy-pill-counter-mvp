import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        annotation: resolve(__dirname, 'annotation.html'),
        benchmark: resolve(__dirname, 'benchmark.html')
      }
    }
  }
});
