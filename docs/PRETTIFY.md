# Ages Ago visual refresh

## Goal and direction

A beautiful, readable ancient-world RTS that fits its procedural low-poly art and
runs within the existing graphics budgets. Warm limestone, muted antique bronze,
olive countryside, terracotta architecture, and clear daylight. The battlefield
is the main visual; controls support it with quiet surfaces and legible states.

Claude Opus 5.5 owns design and interface implementation. Claude Fable 5.1 provides
the independent design/performance critique and world art implementation. Agents
work in the existing isolated `jrmeier/prettify` worktree, based on `36a80cd`.

## Evidence before changes

- All 53 test files / 771 unit tests pass.
- Initial world is dark with a strong orange cast and busy ground patterns.
- Repeated grain, heavy gilt trim, and small all-cap text weaken UI hierarchy.
- At 1280 × 800 the selected-villager panel covers nearly half the battlefield,
  and the minimap overlaps its building choices. This is a layout defect to fix.
- On an Apple M1 Max using Chromium's Metal renderer, seeded initial selected
  scenes have 16.7 ms median and p95 frame intervals at desktop low/high and
  emulated phone low. This is a baseline on this machine, not a phone FPS claim.

## Plan and tickets

1. **#72 / PRETTY-1 — Refine the HUD and recover battlefield space.** Owns `index.html`
   and `src/style.css`. Consolidate surface styling, calm ornament, readable
   resource labels and states, compact selection/build layout, clean minimap and
   control placement, consistent loading/help/endgame panels. Preserve element
   IDs, input contracts, responsive sheets, hidden states, and touch behavior.
2. **#73 / PRETTY-2 — Art-direct the procedural landscape within its current budget.**
   Owns renderer lighting/palette/terrain texture/sky/water styling. Improve
   daylight separation, natural olive ground, quiet microdetail, and coherence
   between ground cover and terrain. Preserve geometry, texture resolutions,
   fog-of-war, picking, shaders' sample counts, and all quality-tier budgets.
3. **#74 / PRETTY-3 — Verify the integrated visual and performance result.** Depends
   on 1 and 2 for final acceptance; benchmark and browser-check preparation can
   run concurrently. Owns a repeatable browser benchmark, layout regression
   checks, and final evidence. Verify selected/unselected desktop, narrow phone,
   touch sheets, minimap, help, first-person, and quality tiers.

## Acceptance

- A visible, coherent improvement in desktop and phone screenshots.
- Selected controls and minimap do not overlap actionable controls; no horizontal
  overflow at 360 px; touch controls retain 44 px targets and safe-area spacing.
- Important labels, focus, selection, insufficient-resource, and alert states
  remain legible; reduced-motion preferences are honored.
- No new dependencies, postprocessing, meshes, continuous ornamental animation,
  large blur/filter layers, higher detail budgets, or gameplay changes.
- Typecheck/build, relevant rendering tests, and existing browser flows pass.
- Same-device warm frame time remains comparable to baseline. Draw calls,
  triangles, GPU geometry/texture counts, pixel ratio, and shadow/grass budgets
  do not increase for equivalent scenes. Report measured limitations candidly.

## Delivery

Initial delivery was local and reviewable. The user subsequently authorized
committing, merging to `main`, and deploying through the existing GitHub Actions
workflow to `https://agesago.jedm.dev`. Tickets #72–74 are in the Ages Ago Brain project. Actual model prompts,
results, screenshots, and measurement JSON are retained locally in
`.agent-delivery/prettify/` (Git-excluded).
All three tickets are complete with verification summaries.

## Model review decisions

Opus 5.5 defined the Aegean palette, warm/cool lighting separation, shared HUD
recipes, readable type, and ground-detail cleanup. Fable 5.1 identified highlight
clipping, texture compositing cost, low-tier depth, resource widths, and vsync
masking as the main risks. Accepted once before implementation:

- Consolidate the model's four art tasks into one renderer lane to avoid palette
  conflicts; retain separate interface and verification lanes (#72–74).
- Tune fill/light/palette through actual screenshots; keep ACES initially and
  avoid global exposure increases. Keep fog mechanics/constants unchanged.
- Remove repeated noise/blending, unify HUD offsets, and reduce selection-panel
  height. DOM IDs and interaction behavior stay fixed; passive labels may be
  added where they improve readability.
- Keep terrain sampling at seven texture reads and existing noise evaluations.
  Match cover tint to ground; preserve counts, quality settings and resources.
- Add uncapped same-GPU comparisons because a 60 Hz frame interval masks spare
  capacity. Vsync baseline remains useful for experienced smoothness only.
- Do not impose arbitrary screenshot luma thresholds as brittle tests, change
  gameplay fog, expand tests across every unchanged flow, or create commits as
  part of local delivery.

## Implemented result

- Shared matte ivory, bronze and umber HUD surfaces; removed repeated SVG grain,
  blending and heavy trim. Resource labels, focus rings, readable unavailable
  building names and reduced-motion behavior remain coherent.
- At 1280 × 800 the selected-villager panel is approximately 764 × 243 px,
  formerly 1050 × 400 px. Its six-column building grid clears minimap and Train.
- Phone sheets scroll with 44 px controls. Full `9,999` resource values and
  `199/200` population fit at 360, 390 and 430 px. Short landscape sheets clear
  minimap, Scout, footer, and Resign; populated control groups remain reachable.
- Softer daylight and cool fill, sage/olive ground, quieter limestone and path
  textures, ground-matched grass lighting, pale horizon and subdued shoreline
  wash. Geometry, quality tiers, texture resolutions, fog mechanics, exposure,
  ACES tone mapping, and shader texture/noise sample counts are preserved.
- No new dependencies, assets, render passes, or gameplay changes.

## Performance evidence

Original revision `36a80cd` and updated workspace were served separately and
measured sequentially on the same Apple M1 Max with Chromium 156.0.8078.4 / ANGLE
Metal, DPR1. Each seeded selected scene had three runs, 180 warm frame samples per
run, and uncapped frame submission. Median of the run statistics:

| Scene | Median before → after | p95 before → after | Draw calls before → after | Textures before → after |
| --- | --- | --- | --- | --- |
| Desktop low, 1280 × 800 | 2.0 → 1.9 ms | 2.6 → 2.6 ms | 136 → 136 | 10 → 10 |
| Desktop high, 1280 × 800 | 2.7 → 2.4 ms | 3.7 → 3.7 ms | 393 → 393 | 13 → 13 |
| Emulated phone low, 390 × 844 | 1.8 → 1.6 ms | 2.5 → 2.4 ms | 75 → 75 | 10 → 10 |

All comparisons pass the uncapped allowance of max(0.25 ms, 10%). No scene
increased draw calls, triangles, GPU geometries, textures, pixel ratio, shadows,
or grass budget. Terrain texture generation also became cheaper by removing
baked meadow dots and stroke searches. The original capped baseline was 16.7 ms
across these scenes; that cap hides available rendering headroom.

These are headless RAF submission intervals, **not GPU completion latency or
physical-phone FPS**. Startup and frame timing vary with host load. Browser/GPU,
platform and pacing metadata must match before the harness compares timings.
The bundled baseline checks structural budgets only; machine-specific timing
evidence is in local `before-final.json` / `after-final.json`.

## Verification and repeatable checks

- Production build/typecheck pass.
- 53 unit files / 771 tests pass cleanly with `npm test -- --maxWorkers=2`.
  The CI unit-test command also uses two workers after the default pool reproduced
  a worker RPC timeout despite all assertions passing.
- Full production browser suite passes: 31 tests, seven intentional project
  skips. It covers gathering, building, fog exploration, queues/rally, walls,
  touch orders, first-person, help, endgame, low/high quality and new layout checks.
- Final layout refinement passes all six applicable focused browser checks;
  low/high desktop boot also passes on SwiftShader (two compatibility tests).
- Final screenshots were inspected at desktop high/low, narrow phone, short
  landscape, lake and first-person. No page errors or horizontal overflow.

The local Metal Playwright override uses dedicated preview port 4187 to avoid
other workspaces' servers. Standard `npm run e2e -- --workers=1` uses the existing
SwiftShader configuration on port 4174; hardware frame timings are never inferred
from that renderer.

```sh
npm run build
npm test -- --maxWorkers=2
npm run e2e -- --workers=1
node scripts/prettify-benchmark.mjs --url http://localhost:5175
```

For hardware timing, run this same harness against a server serving the original
revision, save its output with `--uncapped --runs 3 --output /tmp/before.json`, then
run against the updated server using the same flags and
`--baseline /tmp/before.json`. `--software` is available for portable structural
checks. The initial timing run's legacy capture format is intentionally excluded
from timing comparisons because it lacks environment metadata.
