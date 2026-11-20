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

## Armies, territory and victory

Press **?** in a match for every key, the mouse orders, and a counter table ("who beats what, cost for cost").

- **Upgrades:** select a house, watch tower or palisade and press **Shift+U** (or its button) to upgrade it in place. Examples are House → Large House and Watch Tower → Guard Tower → Fortress Tower. Unit-line upgrades, researched from the Town Age, strengthen and rename a whole line.
- **Ranks:** soldiers gain experience from kills and are promoted Basic → Advanced → Elite. Each promotion improves their stats and heals them to full, and rank marks show above them.
- **Garrison:** put villagers and soldiers inside Town Centers, towers, fortresses and other shelters. Occupants add arrows, the temple heals them, and the town bell (**U**) sends villagers to the nearest shelter.
- **Batch training:** Shift-click a train button (**×5** on touch) to queue five units as one batch.
- **Siege:** the Siege Workshop (City Age, **Shift+B**) trains battering rams, catapults and bolt shooters. Catapults and bolt shooters unpack before they shoot.
- **Fortress, champions and heroes:**
  - The Fortress (City Age, **Shift+N**, at most two) trains each civilization's infantry and cavalry champions.
  - In the Empire Age it also trains the civilization's hero (Leonidas, Scipio, Cyrus or Vercingetorix). A hero carries an aura for nearby troops. Only one can be alive at a time, with a 120 s wait after it falls. Press **;** to select it.
- **Wonder:** the Empire Age goal (**Shift+H**). When it is finished, a victory countdown starts that rivals must stop by destroying it. The timer and the option are set in the match setup.
- **Formations, patrol and guard:**
  - Right-drag a front line with soldiers selected. Pick line, column, box or loose with **Shift+L / Shift+C / Shift+X / Shift+S**.
  - **Q** attack-moves, **Shift+Q** patrols between points, and **Shift+G** or **Alt+right-click** guards a unit or building.
- **Territory:** Town Centers and other key buildings claim borders, and most buildings must go inside them. Buildings cut off from your Town Centers decay unless garrisoned.
- **Capture:** right-click an enemy or neutral building with soldiers to capture it, and garrison it to hold it. **Ctrl+right-click** or the **Raze** button destroys it instead.
- **Computer rivals resign** once they have lost every Town Center and villager and have fewer than five soldiers left. The toast and the end-of-match summary say so.

## Build & deploy

```bash
npm run build   # static site to dist/
```

Pushes to `main` are tested, built and deployed to https://agesago.jedm.dev by `.github/workflows/ci.yml`.
Online play checks a multiplayer protocol version (`NETWORK_VERSION` in `src/network/protocol.ts`, currently 17); deploy the web client and relay together.

## Building and resource work

Villagers and all trained land units—including hoplites, archers, cavalry, priests, and trade carts—can build, gather, farm, and tend livestock. Select them to use the build menu or order them onto a resource or foundation. Their combat, healing, conversion, and trade orders remain available. Ships keep their naval roles.

New orders replace a worker's previous job. When a resource runs out, workers look for the same resource near their assigned work area, then wait if none is reachable. They deliver carried resources before switching resource types.

Build a farm once for 60 wood and assign one worker to it. The worker keeps harvesting and delivering food without exhausting the field or paying to reseed. Unstaffed farms produce no food; farming research increases work speed.

### Livestock corrals

Build a **Corral** once for 100 wood (build menu, **Shift+P**). Scout to claim sheep, select the owned sheep, and move at least two into the marked pasture; moved sheep keep their new home. The pasture markers are not fences: build **Palisades** and a **Gate** around it to contain animals. Gates are available in Village Age. Select a gate and choose **Allow own livestock passage** to admit sheep, then **Block livestock passage** to contain them; your people can still pass, while enemy livestock cannot.

Select a land worker and right-click the completed corral (tap it on touch), or select the corral and use **Assign nearest idle worker**. One worker must be present and tending: with two owned sheep in the pasture, a sheep is born every 45 seconds up to a herd of six, and the worker harvests surplus livestock every 60 seconds for 60 food while retaining two breeders. Production stops without a worker or breeding pair. **Release tending worker**, Stop, or another unit order ends the job. The corral panel shows sheep count, worker status, and a collapsible guide; assignments, progress, and gate settings survive saves and multiplayer commands.

## Villager camera views

Villager views follow the selected own villager, falling back to the first available own villager.
The worker keeps moving, gathering, building, or exploring; camera controls never issue orders.
WASD does not move the villager. POV hides only the followed avatar, and Third-person shows it again.
If that villager dies, is garrisoned/transported, or changes owner, the camera returns to Overhead.
Returning to Overhead preserves its target and zoom. With no available villager, the view stays overhead and explains why.
