import { defineConfig } from 'vite';
const relayProxy = { '/multiplayer': { target: 'http://127.0.0.1:8973', ws: true } };

// `BASE_PATH` lets a build target a subpath
// (e.g. "/agesago/"). Defaults to "/" (agesago.jedm.dev serves from the root).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: {
    host: true,
    port: 5173,
    proxy: relayProxy,
  },
  preview: { proxy: relayProxy },
  build: {
    target: 'es2022',
    // three.js alone is ~550 kB minified; warn only if a chunk grows past that.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // three.js changes far less often than the game: its own chunk stays cached across deploys.
        manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined),
      },
    },
  },
});
