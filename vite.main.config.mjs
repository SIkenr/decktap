import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    commonjsOptions: {
      include: [/client/, /node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // Keep CommonJS packages with optional native accelerators out of the
      // Rollup graph. Bundling ws turns a missing optional `bufferutil` require
      // into a truthy empty module and crashes on masked browser frames.
      external: ['@jitsi/robotjs', 'ws'],
    },
  },
});
