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
    include: ['src/tests/**/*.test.ts'], // src/tests配下のユニットテストを対象
    // exclude: ['electron/tests/video-generator.test.ts'], // Exclude this specific test file
    setupFiles: [],
    transform: {
      '\\.test\\.ts$': 'esbuild', // Use esbuild for test files
      '\\.ts$': 'esbuild', // Use esbuild for other .ts files
    },
  },
}));
