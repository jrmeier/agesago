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

File every reproducible issue as its own ticket with the device and reproduction steps.
Keep #16 open until all three columns have actual device evidence.
