/// <reference types="node" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '..', 'app', 'renderer'),
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, '..', 'dist', 'renderer'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, '..', 'app', 'core'),
      '@renderer': path.resolve(__dirname, '..', 'app', 'renderer')
    }
  },
  server: {
    port: 5173
  }
});
