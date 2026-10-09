# Ages Ago

A browser-based, Age of Empires–style RTS prototype rendered in 3D with **Three.js**.

- Rolling rectangular heightmap landscape (hills, lake, river, forests) with textured ground
- Semi-realistic sprite units and resources billboarded on the 3D terrain
- Economy loop: villagers gather **wood / food / gold** and drop them at the Town Center; train more villagers
- Overhead RTS camera (zoom-to-cursor, pan, edge-scroll) **and** a first-person mode

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173

## Controls

| Input | Action |
|-------|--------|
| Left click | Select villager |
| Left drag | Box-select |
| A | Select all villagers |
| Right click | Move / gather (tree, berry bush, or gold ore) |
| Scroll | Zoom to cursor |
| Right / Space+drag | Pan (screen edges pan too) |
| T | Train villager (50 food) |
| F | Toggle first-person (WASD move, arrows/drag look) |

## Build & deploy

```bash
npm run build   # static site to dist/
```

Pushes to `main` are tested, built and deployed to https://agesago.jedm.dev by `.github/workflows/ci.yml`.
