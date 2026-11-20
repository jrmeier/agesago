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
        // Keep shared title dependencies out of the explicitly assigned match chunks.
        onlyExplicitManualChunks: true,
        manualChunks(id, { getModuleInfo }) {
          // three.js changes less often than the game, so cache it across deploys.
          if (id.includes('node_modules/three/')) return 'three';
          if (!/\/src\/(sim|core|ai)\//.test(id)) return;
          // Shared setup data must not pull the entire sim into the title's static imports.
          // Follow static importers only: Game and the lobby are dynamic entry points.
          const pending = [id];
          const seen = new Set<string>();
          while (pending.length) {
            const current = pending.pop()!;
            if (seen.has(current)) continue;
            seen.add(current);
            const info = getModuleInfo(current);
            if (info?.isEntry) return;
            pending.push(...(info?.importers ?? []));
          }
          return 'sim';
        },
      },
    },
  },
});
