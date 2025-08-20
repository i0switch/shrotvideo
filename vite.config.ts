/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use relative paths in production so Electron can load assets from file://
  base: mode === 'development' ? '/' : './',
  server: {
  host: "127.0.0.1",
  port: 5173,
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'node', // Use node environment for Electron tests
    include: ['electron/tests/**/*.test.ts'], // Only run unit tests from the electron folder
    exclude: ['src/tests/e2e-app.test.ts'], // Explicitly exclude E2E tests from vitest runner
    setupFiles: [],
  },
}));
