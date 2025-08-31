/// <reference types="vitest" />
import path from "path";
import os from "os";
// import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default ({ mode }) => ({
  // Use relative paths in production so Electron can load assets from file://
  base: mode === 'development' ? '/' : './',
  server: {
  host: "127.0.0.1",
  port: 5173,
  },
  // Avoid plugin dependencies; rely on esbuild JSX transform for build
  plugins: [],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  // Avoid duplicate React instances
  dedupe: ["react", "react-dom"],
    conditions: ["module", "browser", "development"],
  },
  // Avoid OneDrive locking under node_modules/.vite by using a temp cache dir
  cacheDir: path.join(os.tmpdir(), "vite-cache-dougadownload"),
  // Use esbuild to transform React JSX automatically
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  optimizeDeps: {
    // Force re-optimize on server start to avoid 504 Outdated Optimize Dep
  force: true,
  exclude: ["react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production'),
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
});