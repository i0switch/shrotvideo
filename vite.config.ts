/// <reference types="vitest" />
import { defineConfig } from "vite";
// import react from "@vitejs/plugin-react-swc"; // Removed
import path from "path"; // Added
// import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // base: './', // Removed this line
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    // Removed react plugin
    // mode === 'development' &&
    // componentTagger(), // Temporarily disable lovable-tagger
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
    // No need for custom transform, vitest handles TS
  },
}));
