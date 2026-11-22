# AI status (M7-2 economy, M8-16 research and ages, M13-6 new age gates, M14-6 upgrades and repairs, M18-5 territory and capture, M16-8 late game, M16-10 match stall)

The computer player (`AIPlayer`) acts only through `world.dispatch(cmd, player)`. It reads its
own units, buildings and stock, enemy units it can see right now, enemy buildings it has seen,
and resource nodes on ground it has explored. Only `hardest` ignores fog (and gets a small
resource trickle).

## Done

- Trains villagers from the Town Center up to the profile's target (36 at moderate).
- Splits gatherers across food, wood, gold and stone by target ratios that change over the game.
- Builds houses before the pop cap stalls villager production.
- Builds drop sites (storehouse, granary, mining camp) next to gatherers working far from one.
- Builds permanent farms after the berries near the base are gone and keeps them staffed. When the
  berries within 40 of the Town Center are nearly picked (200 food or less), it waits for them instead of laying
  a field for a short gap.
- Sends the scout to unexplored ground, then patrols.
- Moves up to two workers per pass from the most over-staffed resource to the most short-staffed one
  it can actually place them on: when there is no free food (fields not yet laid), the next short
  resource gets them instead of the move stopping (M13-6; before, food-short workers piled onto wood
  while gold went unmined). Fields reach further from the Town Center as they multiply (16 + 1.5 per
  field, up to 28).
- Herdables are not population and not soldiers. A sheep in sight does not stall training or call the army home.
- Military (barracks, waves, defence, retreat) is in `military.ts`. It is not part of this ticket's acceptance.

## Acceptance test

`src/ai/economy.test.ts` runs seeds 1–5 at moderate difficulty for 15 sim minutes each against
an idle human. It checks for each seed:

- at least 30 villagers
- no pop-cap stall longer than 10 s while the AI has 30 wood and an idle villager, and no stall at the end
- at least one completed drop site
- the scout moved more than 10 units
- no farm before the home berries are gone
- average AI planning time under 1 ms per sim tick

## M7-3 acceptance tests

`src/ai/military.test.ts` covers scripted early raid defence and counter-unit selection (8 tests).
Six hoplites raid at 4:00 on moderate seeds 1–5: all five Town Centers survive, villagers recover
to 36, and raids clear in 205/85/165/125/175 s (seed 4's obstructed spawn rotates along the same
ring). A flat-field scenario checks sheltering at the 5 s reaction delay and release after the
raid dies. With 60 choices per building, cavalry enemies yield 60 hoplites; infantry yields
60 swordsmen and 60 slingers; archers yield 60 stable horsemen and switch the range to 60 archers.
Counters disabled gives 37 hoplites / 23 swordsmen; unseen enemies still yield a valid choice.
The guards require at least 4/6 raiders killed per seed and 4/5 raids cleared, 70% counter picks,
and 30–70% each barracks unit without counters. Match length remains open in `docs/BALANCE.md`.

## M8-16: research, ages and the market (`research.ts`)

The `Research` planner runs on the build schedule and only issues `research`, `build` and
`marketTrade` commands through `world.dispatch`. `researchBlock` decides what can start; tech
costs are read from `TECHS` (nothing hard-coded, so Balance can retune them).

- **Ages.** Saves for the next age once it has the profile's villager count (moderate: 20 for
  Town, 30 for City) and the current-age buildings (`ageBuildingsNeeded`). It adds what it lacks
  first: storehouse, granary, barracks or mining camp for the Town Age; archery range, forge or
  market for the City Age. While saving, `ctx.reserve` holds the age's cost against army training,
  construction and other research. For the Town Age the TC briefly stops training villagers so it
  can click up (food can't pay for both); for the City Age villagers keep training. Saving gives
  way to the army when it is raided by soldiers or sees an enemy army much bigger than its own, and
  in the Town Age it always keeps a first wave's worth of defenders. No new attack waves start
  while it saves for or researches an age. The Empire Age came with M16-8 (see below).
- **Priority table.** `RULES` lists each tech with a group (eco, tc, forge, line, defence, civ), a
  base priority and a condition. Drop-site chains start once `ecoWorkers` (6 at moderate)
  villagers work that resource. TC techs: wovenTunics at 12 villagers or when raided, donkeyPacks
  at 20, census and townWatch in the Town Age, oxCarts in the City Age. Forge lines follow the
  army's class make-up (3+ units and a quarter of the army). Unit lines start at `lineUnits` of
  that kind (tier-3 lines also need a level-2 building, which `upkeep.ts` provides in the City Age, M14-6).
  Masonry and ballistics need a ranged army; tower upgrades are per building now (M14-2). The profile
  weights each group (0 skips it). The `civ` group has top priority once a forge stands and
  pays from the age-up and building reserves, keeping villager food back; it is off for easy.
- **Budget.** One tech at a time per building, a `gap` between starts, and a food reserve for
  villagers while it is still booming. The TC rests 45 s between techs that block villagers, and
  stays free near an age-up. The best tech it wants but can't afford is held back from army
  training (`ctx.techReserve`). A wanted drop-site tech may pause villager training for at most
  30 s.
- **Buildings.** A forge in the Town Age once it has a production building. An early archery
  range when gold piles up. Up to `towers` watch towers toward the enemy, paid mostly with idle
  stone. An academy in the City Age for a ranged army or towers. A market once a stock nears
  `marketExcess`.
- **Market.** Starts trading once a stock passes `marketExcess` (1,000 at moderate) while a
  needed resource is short (below 200 food/wood, or what the age-up or wanted tech needs). It
  keeps going until that stock is down to half the mark. It sells the surplus for gold and/or buys
  the shortfall, a few lots per pass, and never at a crashed or gouged price.
- **Difficulty.** `Profile.research` (null = never researches or ages; this is the control in the
  tests). Easy: Town no earlier than 14 min, City no earlier than 28, lower group weights, no
  defence techs, 75 s between techs. Hard and hardest: lower thresholds and shorter gaps.
  Personalities with fewer villagers lower the age thresholds to fit.
- **Economy and military changes that support this.** Idle villagers who find no food go to wood
  (for fields) before gold or stone. Unit choice gives a discount to units paid in a resource that
  is piling up, so Town Age archers and swordsmen spend the gold glut.
- `AIOptions.tune` overrides any profile field (tests use `{ research: null }`).
- `harness.armyPower()` measures research-adjusted army strength (statOf hp, armour, attack).

## Acceptance tests (M8-16)

`src/ai/research.test.ts`: seeds 1–5, moderate, against an idle human, with the Balance costs
merged from m8 (Town 400 food; City 3,800 food + 800 gold):

| seed | Town Age | City Age | economy techs by 20 min | AI ms/tick |
|---|---|---|---|---|
| 1 | 8.0 min | 21.1 min | 4 | 0.020 |
| 2 | 8.0 | 19.9 | 7 | 0.019 |
| 3 | 9.1 | 24.4 | 3 | 0.021 |
| 4 | 7.7 | 21.3 | 5 | 0.015 |
| 5 | 7.9 | 21.6 | 5 | 0.017 |

The test asserts Town ≤ 14 min, City ≤ 25 min, at least 3 economy techs (the drop-site chains plus
stoneChisels and threshingFloor) by 20 min, and under 1 ms of planning per tick. Seed 3 is close
to the City limit at the new City cost. Before the Balance merge (City 800 food + 200 gold), City
came at 14.7–17.9 min.

`src/ai/research.versus.test.ts` is a real AI-vs-AI fight, not a proxy. On seeds 1–5, each game
is played twice with the sides swapped, capped at 30 min. A game still running then goes to the
higher score (villagers + soldiers + finished buildings); most games end that way, with one side
nearly wiped out. The researcher won **8/10** (seeds 6–10, tried during tuning: 7/10, so 15/20
overall). This test is heavy: about 5 minutes of wall time for the 10 games.

Caveats:
- The permanent-farm and villager-job changes currently reduce the research-versus-control
  result to **11/20 (55%)**, below the unchanged 75% acceptance target. The original
  `1d41af7` simulation scores **15/20** on the same seeds. Economy, research progression,
  and pacing checks pass; allocation accounting and old-cargo delivery were also checked
  independently. The cause of the competitive result remains unresolved; the test has not
  been relaxed and balance constants have not been retuned to hide it.
- Player 1 has a big edge on these maps: two control AIs split 4–1 for player 1. As player 2 the
  researcher wins about half its games, against roughly 1 in 5 for the control.
- With the new City cost, no researcher reaches the City Age while fighting. Its edge comes from
  the Town Age: archers and swordsmen paid in gold, towers paid in stone, the forge, economy
  techs, and holding waves while it ages.
- Against an idle human, the researcher's army power (`armyPower`) is far below the control's
  until about minute 25, because it banks 3,800 food. It is ahead by minute 30 in 4 of 5 seeds.

## M13-6: the new age gates and unit-line tiers

With M13-1 the archery range and stable open in the Village Age, M13-2 added three-tier unit lines
(tier 1 Town, 2 City, 3 Empire) and M13-3 sped the ages up (Town about 5 min, City about 12).

- **Second military building before the Town Age.** `Profile.secondProduction` picks it: an archery
  range (slingers) for every personality except the rusher, who takes a stable (scouts). The economy
  builds military buildings in the order barracks, second choice, the other one (`productionOrder`,
  fewest-of-a-kind first). The second comes 2 villagers and 30 s after the barracks; later ones keep
  the old spacing. Before saving for the Town Age the research planner lays it itself if it is still
  missing (`production(s, true)`), so it stands when the age arrives. Barracks plus range also cover
  the two Village Age buildings the age-up needs.
- **Mixed army.** Scouts are no longer excluded from training. The starting scouts are explorers
  (`Ctx.explorers`); scouts trained later are soldiers in `Snapshot.army` and fight with the army. Unit
  choice is per building, so a Village Age army is hoplites from the barracks and slingers from the
  range (scouts from a stable), then archers, swordsmen and horsemen join in the Town Age. Enemy scouts
  beyond the first (the explorer) count as cavalry in `Intel.enemyMix`/`enemyArmy`, as raiders for
  villager shelter, and as a raid for research.
- **A unit-line tier per age.** As each age opens, the line rules get a bonus for the age's own tier
  of a unit it fields (2 or more of that kind; most fielded first), and an earlier tier it skipped as
  the way there. The age's tier is `urgent`: while it can't be afforded, cheaper techs wait (for at most
  150 s per age, so a gold-starved economy still gets its other techs), the army leaves its cost
  (`techReserve`), and the market tops it up. `Facts.lines` counts line techs
  researched or queued per tier. Other line tiers still need `lineUnits` of the kind.
- **New pacing.** City Age villager counts are lower (moderate 28, hard 27, hardest 26); easy waits
  until 8 min for Town and 18 min for City (was 14 / 28). The Town Age reserve still pauses villagers
  briefly for its 300 food; the City Age (1,200 food + 500 gold) keeps them training.

`src/ai/research.test.ts` (seeds 1–5, moderate, idle human) now also asserts at least two completed
military buildings when the Town Age arrives and a unit line of tier N started in each age N reached:

| seed | Town Age | City Age | military at Town | line techs (in order) |
|---|---|---|---|---|
| 1 | 5.6 min | 14.5 min | 2 | compositeArcher, cretanArcher, … |
| 2 | 5.7 | 11.5 | 2 | compositeArcher, cretanArcher, … |
| 3 | 5.4 | 14.1 | 2 | compositeArcher, cretanArcher, … |
| 4 | 5.6 | 13.9 | 2 | compositeArcher, cretanArcher, … |
| 5 | 5.4 | 14.7 | 2 | compositeArcher, cretanArcher, … |

Bounds are now Town ≤ 7 min, City ≤ 18 min, and the tier-2 line by 25 min (were 14 and 25 for the old costs).

## M14-6: building upgrades and repairs (`upkeep.ts`)

The `Upkeep` planner runs on the build schedule (all difficulties) and issues only
`upgradeBuilding` and `repair` commands. It starts at most one in-place upgrade at a time, and
every cost leaves `ctx.reserve` (the age-up) untouched. Priority:

1. **Town Center**: one tier per age (Town Hall in the Town Age, City Hall in the City Age), once
   the villager boom is done (villagers + queue at the profile target), or at once when raided.
2. **Watch towers** along their chain when threatened (hit, or an enemy near the base in the last
   minute), or when it has 300 wood and 300 stone to spare beyond the cost.
3. **Military buildings to level 2** in the City Age. The kind that trained the most of the
   current army goes first, once it has trained `lineUnits` of them (the tier-3 line techs require
   a level-2 building), or when it has 400 wood and 400 gold to spare.
4. **Large Houses** within 6 of the pop cap with 100 wood to spare.

An upgrade needs an idle building. When the pick is busy, `ctx.upgradeHold` names it. The
economy (TC villagers), the military (training) and research (techs) then skip it until it is
idle, for at most 30 s. After that the hold lapses and nothing is held for a minute. The house
builder counts a house becoming a Large House as +5 pop going up.

**Repairs.** A threat is an enemy soldier or scout in sight within 30 of the base or 12 of one of
our buildings, or one of ours being hit. Once there has been none for `REPAIR_CALM` (10 s), up to
`MAX_REPAIRERS` (3) villagers repair the next damaged building. The Town Center comes first, then
the most damaged building it can pay a quarter of the missing repair cost for (beyond the
reserve). Farms and buildings under 5% damage are skipped. Repairers are the nearest free
villagers, with farmers last. The economy leaves `toRepair`/`repairing` villagers alone, and the
sim sends them back to idle at full hp.

`src/ai/upkeep.test.ts`:
- Seeds 1–5, moderate, against an idle human, until the City Age: at least one upgraded building
  and under 1 ms of planning per tick.
- Barracks level 2 with a hoplite army.
- The reserve is respected.
- A busy building is held.
- A half-dead Town Center is not repaired while an enemy hoplite stands next to it, and is
  repaired (by at most 3 villagers) once the hoplite is gone.

| seed | City Age | upgrades started (min) | AI ms/tick |
|---|---|---|---|
| 1 | 20.3 min | Large House 7.7, Town Hall 11.9 | 0.013 |
| 2 | 18.7 | Large House 7.6, Town Hall 12.2 | 0.012 |
| 3 | 21.3 | Town Hall 12.4 | 0.017 |
| 4 | 21.0 | Town Hall 13.0, Large House 19.2 | 0.012 |
| 5 | 20.8 | Town Hall 13.1 | 0.013 |

After M13-3/M13-6 (integration I5) the City Age comes at 12–15 min and the Town Age economy keeps
little wood (about 50 when the Town Hall's 200 is due), so the first upgrade now lands shortly
*after* the City Age. `upkeep.test.ts` checks for an upgrade by 20 min instead of by the City Age:

| seed | City Age | first upgrade done | upgrades started (min) |
|---|---|---|---|
| 1 | 15.2 min | 15.2 | Town Hall 12.9, City Hall 15.2 |
| 2 | 12.3 | 13.5 | Town Hall 12.7 |
| 3 | 15.0 | 16.5 | Town Hall 15.7 |
| 4 | 14.5 | 15.0 | Guard Tower 14.4, Town Hall 14.9 |
| 5 | 14.0 | 14.0 | Town Hall 10.9 |

## M18-5: territory, expansion and capture

Territory (M18-1..3) limits where buildings go and capture (M18-4) lets soldiers take buildings.
The AI now plays both.

- **Placement.** `findSpot` already filtered on territory (own land; neutral too for `placeIn:
  'ownOrNeutral'` kinds) and asks `World.canPlace` last, so a legal-looking spot is never issued
  blind. On top of that, `AIPlayer.issue` records why a command was rejected (`ctx.lastReject`,
  `stats.territoryRejected`). When a `build` bounces for `territory` or `blocked-site`, `Economy.place`
  remembers the spot for 120 s (`SpotQuery.avoid`) and tries the next one at once, up to three
  times, so a stale or contested spot never stalls construction. A drop site for gatherers working
  off our land goes at the edge of our territory on the way there (`ownGround`), or is skipped if
  that edge is too far from the work to help.
- **Town Centers are buildable** (sim change, needed for expansion): Town Age, 275 wood + 100 stone,
  Shift+Y (Shift+S became the loose formation in M17-4), last tile of the villager build menu (desktop grid now 8 × 3). The M18-3 neutral-land
  and spacing rules apply.
- **Expansion.** `Profile.expandAt` (villagers; moderate 24, hard and hardest 22, easy never) and
  `Profile.towns` (Town Centers to own; 2, hardest 3). On medium or larger maps (width ≥ 144) in the
  Town Age, `Economy.expand` picks the richest known resource cluster (`expansionSite`: mines and
  every 8th tree as seeds, resources within 14 weighted gold 1.5, stone 1.2, food 0.8, wood 0.4,
  less 40 per unit of distance from home). The cluster must be reachable, on neutral or own land,
  34+ from every known Town Center and nearer home than the enemy. A cluster with no room is skipped
  for 300 s. While it can't afford the Town Center, `ctx.townReserve` holds its cost against army
  training, research and non-essential buildings (houses, farms and drop sites still go up). Every
  finished Town Center trains villagers.
- **Defence against capture.** Raided villagers garrison in the nearest Town Center, tower, temple
  or fortress with room within 30 (they used to just run to the Town Center), which makes it shoot.
  A building losing capture points to enemy soldiers next to it pulls in nearby villagers, and home
  soldiers too when the capturers outnumber the army at home (each occupant wins back 3 cp/s).
  Everyone comes out (`ungarrison`) once things are calm.
- **Capture on offence.** Attack waves capture military and economic buildings (`capture` command)
  while no visible enemy soldier stands within 10 of them, and raze houses, walls, gates and farms.
  Soldiers that walked up and started hitting a capturable target switch to capturing. A capture
  whose points haven't grown for 20 s (a garrison wins them back) turns into razing. Intel drops a
  building once it is ours (or seen in an ally's hands) and follows it to a new enemy owner.
- `harness.makeGame` takes map options (size, type) and sets the save identity.

## Acceptance tests (M18-5)

`src/ai/territory.test.ts`:
- every map type × seeds 1–5 (small maps, 10 min, moderate vs idle human): every foundation the AI
  lays is on legal land, no territory rejections, no pop-cap stall over 15 s, the AI keeps housing,
  under 1 ms per tick;
- forced territory rejections: the AI never re-asks a bounced spot and building carries on;
- a second Town Center on medium (seeds 1–3), large (1–2) and giant (1) maps within 15 min, at
  least the spacing from the first, next to mines or trees, never more than `towns`; none on small;
- scripted capture: six swordsmen capture an undefended barracks (only `capture` orders, hp
  kept, intel forgets it); a house is razed, never captured; a temple held by five garrisoned
  hoplites is captured first, then razed when the capture stalls;
- a Town Center under capture by six swordsmen gets its villagers and its lone hoplite inside, and holds.

Measured with a headless probe (moderate vs idle human, 15 min, seeds 1–5 on every map type): the AI
founded a second Town Center in 46 of 50 medium and large games, between 5.9 and 11.9 min (median
about 8.5). The other four (medium riverValley 2, large highlands 5, large islands 1 and 4) captured
the idle human's Town Center at about 11 min first, which already makes two. No game had a territory
rejection, and planning stayed at or under 0.015 ms per tick. The Town Center search allows a
resource right next to the footprint (`clearOfNodes: 1`) and up to 200 full checks: with the
stricter house settings, dense forests had no spot at all.

## M16-8: siege, fortresses, champions, heroes and wonders

`Profile.late` (`LateGame`) holds the late-game choices: `siege` (engines per attack on a defended
base; 0 = no workshop), `fortresses`, `champions`, `hero` and `wonder`. Easy: 1 engine, no fortress,
champions or hero. Moderate: 2 engines, 1 fortress. Hard: 3 and 1. Hardest: 4 and 2, plus its own
wonder. The turtle adds a fortress (2 at most, the sim's limit).

- **Empire Age.** `ResearchProfile.empireAgeAt` (moderate 36 villagers, hard 44, hardest 50, easy
  never). It saves 4 min after the City Age, and only once the City Age's unit line has started (or
  4 min more have passed). Its 6,500 food is held back as `ctx.reserve`, like the other ages, but
  waves keep going while it saves; only the 150 s of research hold them. While saving, the army may
  still train up to a full wave (it used to be up to the first wave). It adds an Academy or a
  workshop if it lacks one. An AI that starts in a later age (a scenario or a loaded save) counts
  those ages as reached when it is created.
- **Siege workshop.** It is the first City Age building (`Research.buildings`), laid 12–26 from the
  Town Center toward the enemy. Next to the Town Center, a 5×5 shed walled villagers off their
  nodes. While it can't pay for it, `ctx.saving` holds the cost. Army training, research,
  upgrades and non-essential buildings leave that cost alone (houses, farms and drop sites still go
  up), as with `townReserve`; `heldBack(ctx, kind)` sums it all. Without this, the army spent all
  the wood and the workshop never came.
- **Siege training.** Only against a defended base: intel has seen a wall, palisade, gate,
  watch tower or fortress. It keeps up to `late.siege` engines, one in training at a time: rams,
  then catapults once it has half its rams and the enemy has shown 8+ soldiers. The workshop trains
  first. While it can't afford an engine or find pop room, the other buildings leave the engine's
  cost and pop (3) free, so a full army doesn't crowd it out. Siege techs (torsion springs and
  reinforced frames at 2+ engines, quick rigging at 2+ catapults or bolt shooters) are `line`
  rules.
- **Siege in waves.** Against a defended base, a ready wave waits at the rally point for up to
  90 s while a workshop stands and no engine is home. Engines leave with the wave. An engine that
  turns up at the rally point later joins a running attack at once. Engines get `attack` orders on
  the wave's target if it is a wall, tower, fortress or Town Center that isn't being captured.
  Otherwise they take the nearest such building within 30 of it. Each engine gets two escorts with
  the M17-3 `guard` order: the nearest free soldiers in the group, never the hero. They walk with
  it and fight whoever attacks it, and the wave's other orders leave them alone until the engine
  dies.
- **Fortress, champions and hero.** It builds `late.fortresses` fortresses in the City Age, 10–22
  toward the enemy, once it has 80% of its villager target and 750 stone. The fortress trains the
  hero first: Empire Age, `heroBlock` clear, affordable beyond the reserves. Champions come next, by
  the usual counter scoring: in the Empire Age, or in the City Age with 1,200 spare gold. Heroes
  are never picked by `chooseUnit`. Pop checks use `popCost`, so siege counts 3.
- **Enemy wonder.** While `world.wonder` counts down for an enemy, `Military.answerWonder` runs
  before defence. Every soldier, siege included, joins the attack on the wonder: attack-move
  there, then capture (or razing if the capture stalls). Orders go out up to 14 a pass, and
  units are re-sent when they go idle. There is no retreat and no recall for raids at home. The
  countdown is public (everyone sees the timer and the ping), so knowing where the wonder is
  breaks no fog rule. The rush ends when the wonder falls or changes hands.
- **Own wonder.** While it holds a completed wonder, no waves launch. A running attack is called
  home, and the rally point moves next to the wonder. The normal base defence covers it, since
  threats within 10 of any of our buildings count.
- **Own wonder (hardest).** In the Empire Age, with no wonder standing, it builds one if it has
  its villager target, 20+ soldiers, twice the enemy army it has seen, and the cost beyond the
  reserves.

## Acceptance tests (M16-8)

`src/ai/late.test.ts`:
- Seeds 1–5, moderate. The AI starts in the City Age with 3,000 food and wood, 2,000 gold and
  1,000 stone, against an idle human behind a stone wall ring with four watch towers. In every
  seed a ram reaches the walls with the first wave at 11.0 min, with 4 escorts guarding the
  engines. The wave launched with its siege, there were at most 1 rejected command, and planning
  took 0.012–0.019 ms per tick.
- Escorts: 1–2 guards per engine, and the ram's target is a wall, tower or Town Center.
- The City Age AI builds a workshop and a fortress. In the Empire Age with a fortress, it trains
  its hero (Leonidas) and 4 champions in 3 min.
- Seeds 1–3: an enemy wonder completes and the countdown starts. The AI's army is hitting it
  44 s into the 300 s countdown, with `wonderRush` set.
- With its own wonder and 24 swordsmen it launches no wave in 3 min, and all of them stay within
  30 of the wonder.

A natural game can't serve as the walled-base test. The moderate AI's Town Age army (30–60
soldiers by 12–15 min) takes an idle human's walled, towered, even fortified base before its
first engine exists, by capture and by sheer numbers. In a natural game the workshop now stands
by about 15 min, and rams join the running attack.

## M16-10: the AI-vs-AI stall

See `docs/BALANCE.md` ("AI-vs-AI match length") for the bench numbers and the diagnosis.

- **Gold.** The second Town Center goes to untouched gold first: a mine still holding 300+ seeds a
  site, and wood counts 2,000 at most, so a forest no longer outbids the new expansion clusters
  (`EXPANSION_GOLD`). The worker split and the market count every reserve (`heldBack`: age-up,
  Town Center, building being saved for). The market never buys with gold held back; gold beyond
  half the glut mark plus the reserve buys what is short; with no gold mine known, food, wood or
  stone beyond the reserve plus 300 is sold for the gold that is short.
- **Saving for an age.** The Town and City Age saves hold attack waves for 3 minutes at most
  (`AGE_WAVE_HOLD`). Raided, the AI spends the reserve on soldiers only while its army is below
  1.25 × the enemy army seen + 10.
- **Attack waves.** An attack below 35% of the soldiers committed to it is called off
  (survivors go home, the next wave musters); reinforcements join only while it holds 60%. A
  threat at home recalls it only with 5+ soldiers, at least half the attack's size, while the wave
  is still nearer home than its target; the attack keeps running while home defends. Wave
  soldiers on a building turn on an enemy soldier within 9 first (the sim does not make a razer
  fight back), and near a contested target they close in with attack-move.
- **Endgame.** With no enemy building known, the army hunts in squads of 6: last sightings of
  enemy units, then unexplored ground, then ground out of sight. A computer player with no Town
  Center (after having one), no villager and fewer than 5 soldiers resigns with a dispatched
  `resign` command; never for a human-controlled player. The UI toasts "<name> resigned" and the
  end sheet names who resigned.
- Tests: `src/ai/stall.test.ts` (expansion site, market, waves, recall, age hold, army-first,
  resignation), `src/ai/territory.test.ts` (fight-first, hunt), `e2e/endgame.e2e.ts`.

## Open

- No market techs (coinage, caravans) and no trade carts.
- No walls, fortified walls or machicolations (so no wall upgrades either).
- The Empire Age is rare in a 30-minute game (6,500 food). In the Empire Age the AI has no
  dedicated plan for tower tier 2 or the Imperial Palace.
- Bolt shooters are never trained. Siege doesn't retreat on its own, and it isn't repaired.
- Defending against enemy siege is still the general base defence; there is no anti-siege
  targeting.
- The AI does not move gatherers to stone to pay for a repair; it waits until it can afford one.
- One expansion target at a time; no third Town Center below hardest, and no expansion on small
  maps. It doesn't defend an expansion beyond the general base-radius defence.
- The AI doesn't recapture its own lost buildings on purpose, and it doesn't reinforce a capture
  that stalls; it razes.
- Relics are out of scope. The wonder answer has no special timing: it sends whatever army it has,
  however small.
