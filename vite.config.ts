import { defineConfig } from 'vite';

// `BASE_PATH` lets a build target a subpath
// (e.g. "/agesago/"). Defaults to "/" (agesago.jedm.dev serves from the root).
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
