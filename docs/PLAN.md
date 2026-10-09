# Ages Ago — Plan

Merged from three independent planning passes (Claude Code, Codex, Cursor Agent), 2026-10-09.
Brain project: **Ages Ago** (jmain), wing `ages-ago`.

## Where we are

- `src/main.ts` imports `./world/GameWorld`, which doesn't exist → `tsc` fails → every Pages deploy fails.
- What exists is a HUD shell (`index.html`, `style.css`) plus three unused helpers.
- **Keep:** HUD markup/CSS (its element ids are the UI contract), `vite.config.ts` `BASE_PATH`, deploy workflow, `buildTownCenter()`, sky/water/terrain palette.
- **Delete:** `src/game/constants.ts` (2D isometric leftovers: `ISO_TILE_*`, autotile, `TileData`, duplicate `COLORS`), `TILE_HEIGHT`/`TILE_BASE` (stepped block terrain contradicts the heightmap README).
- **Rewrite:** `ResourceNode` mixes sim with Three.js, and `take()` accepts negative amounts (would *add* resources).

## Architecture

One rule: **`src/sim/` is plain TypeScript with no `three` import**, working in 2D `(x, z)` ground coordinates. The only way to change game state is `world.dispatch(Command)`. Rendering, cameras, input and HUD read the sim. This keeps the economy unit-testable and lets both cameras share one model.

World: 64 × 48 units (≈ metres), Y up, sea level 0, fixed seed 1. Sim ticks at a fixed 20 Hz (accumulator, max 3 steps/frame); rendering interpolates.

```
src/
  main.ts                  boot → new Game(container)
  core/types.ts            Vec2, EntityId, ResourceType, Command, SimEvent, entity data   [frozen]
  core/events.ts           typed EventBus                                                  [frozen]
  sim/balance.ts           costs, rates, speeds, carry cap, pop cap
  sim/terrain.ts           generateTerrain(seed) → Heightfield (hills, lake, river, forest mask)
  sim/mapgen.ts            populate(world): flattened TC pad, 3 villagers, trees/berries/gold
  sim/nav.ts               grid A* over Heightfield.isWalkable + building footprints
  sim/World.ts             entity store, dispatch(), tick(), stockpile
  sim/systems/*.ts         movement, gather FSM, train queue
  render/Renderer.ts       WebGLRenderer, scene, lights, sky, fog, resize
  render/TerrainView.ts    displaced mesh + vertex colours + animated water plane
  render/sprites.ts        procedural CanvasTexture sprites (villager, tree, berry, gold)
  render/EntityViews.ts    id → view sync, Y-axis billboards, selection rings, move marker, picking
  render/buildings.ts      Town Center (ex-Props.ts)
  render/palette.ts        colours (ex-config.ts)
  camera/RtsCamera.ts      zoom-to-cursor (hits terrain), pan, edge scroll, clamps
  camera/FpsCamera.ts      terrain-following observer
  camera/CameraRig.ts      owns the PerspectiveCamera, F toggles mode
  input/Input.ts           raw pointer/keyboard state, click-vs-drag threshold (5 px)
  input/pickGround.ts      ray vs Heightfield → Vec2
  input/Controls.ts        selection + RMB orders + hotkeys
  game/Selection.ts        selected ids (UI state, not sim)
  game/Game.ts             composition root and main loop
  ui/Hud.ts                binds the existing DOM ids
```

## Decisions (defaults — owner can override)

| Question | Default |
|---|---|
| Sprite art | Procedural canvas sprites for M1; real art is an M2 item once a source/licence is chosen |
| Pathfinding | Grid A* in M1 so villagers don't walk on the lake/river; the river gets one ford |
| `A` key | Select-all in RTS mode, strafe in first person |
| First person | Observer only — no selection or orders |
| Training | 50 food, 8 s, pop cap 25 |
| Economy | Carry 10, 1 unit per 0.8 s, starting stock 0 food / 0 wood / 0 gold |
| Billboards | Y-axis billboards, not `THREE.Sprite` (spherical sprites look wrong in both cameras) |
| Shadows | Off through M1 (hundreds of trees); blob shadows under units |

## M1 — Smallest playable slice (builds, deploys, does what the README says)

| # | Ticket | Lane | Size | Acceptance |
|---|---|---|---|---|
| T1 | Contracts + skeleton | Integrator | M | Shared types frozen; stub per module; stale files removed; lockfile + vitest; `npm run build` passes; page shows sky + HUD |
| T2 | Terrain + map generation | World | M | Seeded hills, lake, river with a ford, forest mask; flat TC pad; deterministic; tests: same seed → same heights, lake centre is water, TC pad walkable, every resource reachable from TC |
| T3 | Sim: entities, nav, systems | Sim | L | Tests: villager gathers to carry cap, walks to TC, stock rises only on deposit; depleted node → villager retargets nearest same type; train at 49 food rejected, at 50 spends 50 and spawns after 8 s; paths avoid water and TC footprint |
| T4 | Rendering | Render | M | Terrain mesh matches `heightAt`; water plane; Y-billboard sprites anchored at feet; ~400 trees via instancing at ≥55 fps; selection rings; move marker; `pick` / `idsInRect` |
| T5 | Cameras | Controls | M | Zoom keeps the terrain point under the cursor; RMB-drag & Space-drag pan; 18 px edge scroll (ignores HUD buttons); clamps; F toggles a terrain-following observer and restores the RTS pose |
| T6 | Input, selection, HUD | Controls | M | Click / 5 px box / A select; RMB on node = gather, on ground = move, drag = pan (no order); T and button share `train`; counters + selection panel update from events; button dims below 50 food |
| T7 | Integration + deploy | Integrator | S | Real wiring in `Game.ts`; `npm ci && npm run build` clean; root and `/agesago/` builds load; README controls table checked row by row |

## M2 — Feels like an RTS

Group formations, walk/chop animation, carried-resource indicator, stump on depleted trees, minimap, real sprite art + `ASSETS.md`, multi-seed validation (seeds 1–20 valid), pause/speed.

## M3 — Content

Houses + pop cap, lumber/mining camps as drop sites, building placement ghost, fog of war, save/load (the sim is plain data → JSON).

## Parallel lanes

T1 is serial and blocking. After it lands, four lanes run concurrently, each owning only its files:

| Lane | Ticket(s) | Owns | Agent |
|---|---|---|---|
| World | T2 | `sim/terrain.ts`, `sim/mapgen.ts`, their tests | Codex |
| Sim | T3 | `sim/World.ts`, `sim/nav.ts`, `sim/systems/*`, `sim/balance.ts`, their tests | Claude Code |
| Render | T4 | `render/*` | Cursor Agent |
| Controls | T5 → T6 | `camera/*`, `input/*`, `game/Selection.ts`, `ui/Hud.ts` | Claude Code |

Only the integrator edits `core/*`, `game/Game.ts`, `main.ts`, `index.html`, `style.css`, `package.json`. Contract changes are requested, not made in-lane. T7 waits for every lane.

## Open questions for the owner

1. Where should real sprite art come from, and under what licence?
2. Are the economy numbers above the right feel for the first minute?
3. Target hardware / browsers for the frame-rate goal?
