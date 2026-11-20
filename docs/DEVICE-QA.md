# Physical-device QA (#16)

Open the deployed game with `?debug=1`. The expandable Performance panel reports rolling
FPS, mean/p95 frame intervals, quality tier, pixel ratio, rendered triangles/draws, WebGL
geometry/texture counts, JS heap where the browser exposes it, boot time and simulation time.
It is absent by default and can be collapsed on narrow screens.

Physical acceptance remains pending: the user confirmed no iPhone, Android phone or tablet
is currently available for this pass. Browser viewport emulation and software WebGL are
automated regression evidence only; they cannot establish device FPS, touch behavior,
memory pressure or thermal stability.

Record device/OS/browser, build SHA, tier, dimensions and debug counters for each device:

| Check | iPhone / Safari | Android / Chrome | Tablet |
|---|---|---|---|
| 360×640 through full-size layouts; safe-area insets | Pending | Pending | Pending |
| Tap/long-press selection, pinch/pan, work orders and phone sheets | Pending | Pending | Pending |
| Tier detection, low-tier FPS and memory after 5/15/30 minutes | Pending | Pending | Pending |
| Background/resume, orientation and long-session thermal behavior | Pending | Pending | Pending |
| Loading screen paint and before/after time to interactive (#17) | Pending | Pending | Pending |

Emulated loading comparison for L17 (2026-11-20, **not physical-device acceptance**):
production builds in Chromium/SwiftShader, Pixel 7 emulation, CDP
`Emulation.setCPUThrottlingRate` = 4 and `Network.emulateNetworkConditions` =
1.6 Mbit/s down, 750 kbit/s up, 150 ms latency, fresh browser contexts with cache disabled.
Ten runs per build, alternating before/after order; medians measured from navigation:

| Emulated check | Before (`d3a772d`) | After (L17 bundle split) | Change |
|---|---:|---:|---:|
| First title button visible on `/` | 1.293 s | 1.061 s | −17.9% |
| New match opens setup on `/` (additional interaction check) | 3.120 s | 1.619 s | −48.1% |
| `window.game.renderer.webgl.info.render.frame > 5` on `/?e2e` | 12.158 s | 11.234 s | −7.6% |

The before build has the same app/Three.js assets as audited `7157fcc`. The original audit
reported about 1.0 s / 5.4 s for title / first frames, with 2.19 s of boot stages; its
unthrottled loading-card parse was 141–150 ms and first paint 156–164 ms. This comparison
re-measured both builds on the busy shared host (load averages around 50–75): first-frame
samples ranged 8.379–13.618 s before and 8.110–15.430 s after. Median boot stages were
7.278 s / 5.870 s. The matched medians meet the 10% no-regression limit; absolute timings are
host-dependent. The L17 worker report and its `L17-evidence` directory contain the raw
samples and measurement script. The pending phone row above still requires a real device (#16).

File every reproducible issue as its own ticket with the device and reproduction steps.
Keep #16 open until all three columns have actual device evidence.
