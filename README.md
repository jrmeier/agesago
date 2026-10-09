# Ages Ago

A browser-based, Age of Empires–style RTS prototype rendered in 3D with **Three.js**.

- Rolling rectangular heightmap landscape (hills, lake, river, forests) with textured ground
- Low-poly 3D villagers, trees, berry bushes and gold built in code (no image assets)
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

### Touch (phones & tablets)

| Gesture | Action |
|---------|--------|
| Tap villager | Select |
| Tap resource / ground (with selection) | Gather / move |
| One-finger drag | Pan |
| Pinch / two-finger drag | Zoom / pan |
| Long-press, then drag | Box-select |
| **All** / **None** / **View** buttons | Select all / deselect / first-person |
| First-person | Left thumb joystick moves, right side drag looks |

## Build & deploy

```bash
npm run build   # static site to dist/
```

Pushes to `main` are tested, built and deployed to https://agesago.jedm.dev by `.github/workflows/ci.yml`.
