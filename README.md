# Ages Ago

A browser-based, Age of Empires–style RTS prototype rendered in 3D with **Three.js**.

- Rolling rectangular heightmap landscape (hills, lake, river, forests) with textured ground
- Low-poly 3D villagers, trees, berry bushes and gold built in code (no image assets)
- Fog of war: the 176×176 map starts black; send your mounted scout to explore it
- Economy loop: villagers gather **wood / food / gold** and drop them at the Town Center; train more villagers
- Overhead RTS camera (zoom-to-cursor, pan, edge-scroll) plus **Villager POV** and **Third-person** follow views

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
| F | Cycle Overhead → Villager POV → Third-person (arrows/drag look; wheel adjusts third-person distance) |

### Touch (phones & tablets)

| Gesture | Action |
|---------|--------|
| Tap villager | Select |
| Tap resource / ground (with selection) | Gather / move |
| One-finger drag | Pan |
| Pinch / two-finger drag | Zoom / pan |
| Long-press, then drag | Box-select |
| **All** / **None** / **View** buttons | Select all / deselect / cycle camera views |
| **Explore** button / horse button | Auto-explore / jump to scout |
| **Menu** | Pause, settings, help, save / open, new match, or resign |
| **Map** | Open or fold the minimap; tap or drag it to move the camera |
| **Groups** | Open control groups; hold a numbered slot to assign the selection |
| **Build** / **Train** / **Orders** | Open the selected unit or building's actions; **Close** returns to the map |
| Villager views | Drag anywhere on the scene to look / orbit; tap the labeled view button to cycle |

## Exploration and naval play

Send any unit to a discovered ruin to claim its one-time resource or technology cache. Build a Temple in Town Age and train a Priest to collect a relic; bring the priest near your temple to earn 30 gold per minute. Order priests onto injured allies to heal or visible enemy land units to channel a conversion.

Choose **Islands** in the match setup for connected sea lanes. Build a **Dock** across a shoreline to train Fishing Boats, Merchant Ships, Triremes and Transports. Order fishing boats onto water fish to deliver food to an own dock. Order a merchant ship onto another own or allied dock to trade between it and your home dock. Triremes attack enemy ships.

Move a transport near shore, then order selected land units onto it to board. Select the loaded transport, press **Unload**, and click or tap a reachable coast. On a phone, ship training is in the **Train** sheet and unloading is in **Orders**.

## Build & deploy

```bash
npm run build   # static site to dist/
```

Pushes to `main` are tested, built and deployed to https://agesago.jedm.dev by `.github/workflows/ci.yml`.
The livestock and permanent-farm simulation uses multiplayer protocol 2; deploy the web client and relay together.

## Villager work

New orders replace a villager's previous job. When a resource runs out, villagers look for the same resource near their assigned work area, then wait if none is reachable. They deliver carried resources before switching resource types.

Build a farm once for 60 wood and assign one villager to it. The villager keeps harvesting and delivering food without exhausting the field or paying to reseed. Unstaffed farms produce no food; farming research increases work speed.

### Livestock corrals

Build a **Corral** once for 100 wood (villager build menu, **Shift+P**). Scout to claim sheep, select the owned sheep, and move at least two into the marked pasture; moved sheep keep their new home. The pasture markers are not fences: build **Palisades** and a **Gate** around it to contain animals. Gates are available in Village Age. Select a gate and choose **Allow own livestock passage** to admit sheep, then **Block livestock passage** to contain them; your people can still pass, while enemy livestock cannot.

Select a villager and right-click the completed corral (tap it on touch), or select the corral and use **Assign nearest idle villager**. One villager must be present and tending: with two owned sheep in the pasture, a sheep is born every 45 seconds up to a herd of six, and the worker harvests surplus livestock every 60 seconds for 60 food while retaining two breeders. Production stops without a worker or breeding pair. **Release tending villager**, Stop, or another unit order ends the job. The corral panel shows sheep count, worker status, and a collapsible guide; assignments, progress, and gate settings survive saves and multiplayer commands.

## Villager camera views

Villager views follow the selected own villager, falling back to the first available own villager.
The worker keeps moving, gathering, building, or exploring; camera controls never issue orders.
WASD does not move the villager. POV hides only the followed avatar, and Third-person shows it again.
If that villager dies, is garrisoned/transported, or changes owner, the camera returns to Overhead.
Returning to Overhead preserves its target and zoom. With no available villager, the view stays overhead and explains why.
