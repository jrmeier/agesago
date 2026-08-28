import { defineConfig } from 'vite';

// `BASE_PATH` lets the GitHub Pages workflow build under a repo subpath
// (e.g. "/agesago/"). Defaults to "/" for local dev and root-domain hosts.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
