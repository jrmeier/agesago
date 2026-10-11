# Ages Ago

A browser-based, Age of Empires–style RTS prototype rendered in 3D with **Three.js**.

- Rolling rectangular heightmap landscape (hills, lake, river, forests) with textured ground
- Low-poly 3D villagers, trees, berry bushes and gold built in code (no image assets)
- Fog of war: the 176×176 map starts black; send your mounted scout to explore it
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
| E | Explore (send selected units, e.g. the scout, to auto-explore) |
| . / Home | Jump to your scout (cycles if several) |
| H / S / G / M / P | Build House / Storehouse / Granary / Mining Camp / Farm (villagers selected) |
| R or Shift+Scroll | Rotate the building while placing (Shift-click keeps placing; Esc / right-click cancels) |
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
| **Explore** button / horse button | Auto-explore / jump to scout |
| First-person | Left thumb joystick moves, right side drag looks |

## Exploration and naval play

Send any unit to a discovered ruin to claim its one-time resource or technology cache. Build a Temple in Town Age and train a Priest to collect a relic; bring the priest near your temple to earn 30 gold per minute. Order priests onto injured allies to heal or visible enemy land units to channel a conversion.

Choose **Islands** in the match setup for connected sea lanes. Build a **Dock** across a shoreline to train Fishing Boats, Merchant Ships, Triremes and Transports. Order fishing boats onto water fish to deliver food to an own dock. Order a merchant ship onto another own or allied dock to trade between it and your home dock. Triremes attack enemy ships.

Move a transport near shore, then order selected land units onto it to board. Select the loaded transport, press **Unload**, and click or tap a reachable coast. On a phone, ship training is in the **Train** sheet and unloading is in **Orders**.

## Build & deploy

```bash
npm run build   # static site to dist/
```

Pushes to `main` are tested, built and deployed to https://agesago.jedm.dev by `.github/workflows/ci.yml`.
