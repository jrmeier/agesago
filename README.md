# Ages Ago

A browser-based Age of Empires-inspired RTS prototype with **isometric rendering** and **autotiled terrain**.

## Phase 1 — Technical Toy

- **Isometric perspective** (2:1 diamond tiles, AoE-style)
- **Autotile transitions** — smooth grass ↔ sand ↔ water ↔ dirt blending
- Procedural terrain with river, forests, and town center
- Camera pan (Space+drag / edge scroll) and a close RTS zoom (no god-view)
- Fog of war — the map is discovered as villagers explore
- Unit selection and move commands
- Visual polish: animated water, dust particles, selection ring, HUD

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Controls

| Input | Action |
|-------|--------|
| Left click | Select villager |
| Drag | Box select |
| Right click | Move selected unit |
| Space + drag | Pan camera |
| Scroll wheel | Zoom |
| Screen edges | Pan camera |

## Architecture

```
src/game/
  IsoCoords.ts        — cartesian ↔ isometric coordinate conversion
  AutotileFactory.ts  — procedural isometric tile + transition textures
  TerrainRenderer.ts  — autotile edge/corner overlay rendering
  MapGenerator.ts     — procedural terrain (cartesian grid)
  entities/Unit.ts    — cartesian movement, isometric rendering
```

## Stack

- Vite + TypeScript
- Phaser 3
