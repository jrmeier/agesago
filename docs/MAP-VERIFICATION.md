# Map verification

On 2026-10-10, all 20 size × landscape combinations generated, started and rendered in hardware-backed Google Chrome on an Apple M1 Max at low graphics quality and 1280×800. Generation took 28–395 ms; measured frame rates were 60–120 FPS (minimum 59.99), with frame p95 no higher than 17.6 ms. This meets the existing 55 FPS laptop target. Measurements cover the initial gameplay view and default two-player starts, rather than late-game army stress or physical phone performance.

Raw data: [maps-low-tier-2026-10-10.json](maps-low-tier-2026-10-10.json). Map tests separately cover deterministic generation, multi-player resources, land and sea reachability, terrain geometry and saved map identity.

Reproduce against a running production build:

```sh
MAP_RENDER_BASE_URL=http://localhost:4174 node scripts/bench-render-maps.mjs
```

The script opens installed Google Chrome with its normal hardware renderer, checks the actual GPU renderer string, and samples frame intervals after warming up each map. Software WebGL browser smoke tests establish interaction behavior and rendering correctness; they are not FPS evidence.
