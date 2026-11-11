# Progression balance (M8-17, retuned in M13-3)

How fast a game moves through the ages, why each economy tech costs what it does, and how to
check both again after a change.

## Pacing targets

| Age | Target | Band the bench accepts |
|---|---|---|
| Town Age | about 5:00 | 4:00–6:00 |
| City Age | about 12:00 | 10:30–13:30 |
| Empire Age | about 20:00 | 18:00–22:00 |

Like 0 A.D. phases, an age-up is a modest cost plus a building count: two distinct completed
buildings from the current age (`AGE_BUILDINGS_NEEDED`; only the Academy for the Empire Age).

**Starting stockpile.** Every player starts with 200 food, 200 wood, 100 gold and 100 stone
(`BALANCE.startingStock`), so at 0:00 they can queue villagers and lay a first drop site.

Every economy tech has to **pay for itself within 5 sim-minutes** of clicking it, research time
included, with a typical crew of 6–10 villagers on that resource. Bronze Axe should take about
3 minutes with 8 woodcutters.

## Military unlocks

Village Age allows Barracks, Archery Ranges and Stables, training Hoplites, Slingers and
Scouts respectively. Two distinct completed Village Age buildings are needed for Town Age;
Archery Ranges and Stables count toward this requirement.

Town Age unlocks Archers, Horsemen, Swordsmen, civilization unique units, Priests, Trade Carts,
Merchant Ships and Triremes, plus the Forge, Market, Watch Tower, Temple and Stone Wall.
Archery Ranges and Stables do not count as Town Age buildings for the City Age requirement.

## Damage types (M16-1)

Attacks and armour have three types: melee (hack), pierce and crush. One blow deals
Σ max(0, attack − armour) over the three, at least 1, plus the class bonus against units.
Buildings have high melee and pierce armour and crush armour 0 (Masonry and Architecture add +1
each, Fortified Walls +2 on walls and gates). Swords and arrows barely scratch them, and crush
(siege) brings them down. Infantry carry 2 crush, cavalry and villagers 1, and ranged units and
ships 0. Units default to 2 crush armour (`UNIT_CRUSH_ARMOR`), which soaks that small crush, so
unit-vs-unit damage is the same as before. Targets with no research, checked in `src/sim/crush.test.ts`:

| 10 Swordsmen vs | Time to destroy |
| --- | --- |
| House | 28 s |
| Stone Wall segment | 120 s |
| Town Center | 240 s |

Warships (triremes) carry 2 crush, the same as infantry: they can pull down a shoreline house
slowly but are no substitute for siege.

## Siege (M16-2)

The Siege Workshop (City Age, 300 wood + 150 stone) trains three engines of class `siege`.
Siege units take several population slots (`UnitSpec.pop`), do not rank up and cannot work.

| Engine | HP | Attack | Armour m/p/c | Range | Reload | Pop | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Battering Ram | 350 | 50 crush | 1/12/4 | melee | 2 s | 3 | Attacks only buildings and siege |
| Catapult | 180 | 40 crush | 1/6/4 | 5–16 | 5 s | 3 | Splash radius 2, falloff, hurts own units; unpacks |
| Bolt Shooter | 150 | 25 pierce | 1/6/4 | 14 | 4 s | 2 | Bolt passes through up to 3 enemies in a line; unpacks |

- Catapults and bolt shooters must unpack (3 s) before they shoot and pack (3 s) before they move.
- Melee infantry get +8 against siege, horsemen +10, scouts +4; arrows do 1 to a ram.
- Workshop techs: Torsion Springs (+20% siege attack), Reinforced Frames (+20% siege HP), Quick
  Rigging (pack and unpack twice as fast).
- The Siege Workshop counts as a City Age building for the Empire Age, but the Academy alone is
  still enough.

Checked in `src/sim/siege.test.ts`: 3 rams bring down a stone wall segment in about 14.5 s
(10 swordsmen still need over 60 s); 10 swordsmen kill an unescorted ram in a few seconds.

## The scripted build order

`src/bench/pacing.ts` plays player 1 on a real generated map (`generateMap(seed, 2)`, the real
`World`, no AI). It plays like a steady human player, not an optimised rush:

- It trains villagers without stopping, up to 70. The Town Center stops only while it researches,
  and once the Town Age is only waiting on food, it banks food instead of training (as a player
  going up would).
- It builds houses ahead of population (up to 200), drop sites next to the nearest berries, trees,
  gold and stone (and moves on as they run out), then permanent farms once the berries are gone.
- It splits villagers by the age it is working toward. The Village Age is 65% food and 35% wood.
  Later ages bring in gold and stone. When a resource runs out within reach, its share goes to the
  other resources.
- **It keeps a standing army.** From the Town Age it has one barracks per age past Village, each
  training hoplites without stopping, up to 125 soldiers. This stands in for a real player's
  military spending, so age-ups compete with it for food and wood. Without it, a 70-villager
  economy piles up resources and the costs can't produce a real game's arc.
- It researches economy techs when they're worth it: Bronze Axe at 5 woodcutters, Ox Plough at
  3 farms, and so on. Bronze Axe, Iron Axe and Iron Ploughshare come before the next age-up.
  Techs from an earlier age are bought alongside the age-up but don't hold it up. The rest wait
  until that age-up is paid for.
- It ages up as soon as it has the buildings and can pay. For the Town Age it builds a storehouse
  and a granary (the granary even when the berries are close enough to use the Town Center), for the City Age a forge and a market, and for the Empire Age an academy. If gold is
  the only thing missing, it sells spare wood or food at the market.
- It knows the map (its fog is explored at the start), so building placement never waits on scouting.

## Wonder (M16-7)

The wonder is the Empire Age's end goal: 1000 food, 1000 wood, 1000 stone and 1000 gold,
400 s for one builder, a 6 × 6 footprint and 8000 hp (armour 10/15/0 like the Town Center, so per M16-1 crush is what razes it). With Empire reached at
about 30:00–35:00, a town needs several more minutes of full income to pay for it, so a wonder
is a late, visible commitment that rivals have time to answer. When it finishes, a countdown
(match option, default on, 300 game seconds; 3/5/10/15 min in the menus) starts for every
player. Destroying the wonder cancels it; with several standing, the earliest finished counts.


**Payback.** `crewRate` sets a crew to work on the same map, with the drop site next to the
resource, and measures net income over 300 s after a 30 s warm-up. It runs once without the tech
and once with it, and both arms already have the earlier techs in the chain. Payback is then

```
gain     = rate_with − rate_without            (resources / s)
payback  = research_time + total_cost / gain   (s)
```

- `total_cost` adds up every resource at face value.
- Nodes are topped up so neither arm runs dry, which means the difference comes from the tech alone.
- Farms cost wood only when first built and produce food indefinitely while staffed. Farm
  research increases work speed; measured income has no recurring reseeding deduction.
- Carry and speed techs (Donkey Packs, Ox Carts) are measured on a mixed crew, because they help
  every villager.

**Repair.** Workers restore an own or allied completed building at
`maxHp × n^buildExponent / (buildTime × repairTimeFactor)` hp/s for `n` repairers
(`repairTimeFactor` 1.5). A full 0 → max repair costs `repairCostFactor` (0.5) × the building's
cost, paid by the repairer's owner one whole resource at a time as the hp go up; a player who can't
pay the next unit stops repairing. A damaged ship near an own finished dock heals for free at
`dockHealRate` (1.5 hp/s).

**Age cost scale.** Villagers here gather about 0.7–0.8 resources/s and train in 8 s, so incomes
are roughly 4× an AoE2 game's. That puts the scripted economy at about 700/min at 3 min,
2,300/min at 10 min, 2,700/min at 15 min and 3,700/min at 20 min. Each age costs modest
minutes of that income on top of villagers and the army; the building count sets the rest of the pace:

- Town Age: 300 food, 45 s (about a minute of Village food once the two buildings are up)
- City Age: 1,200 food and 500 gold, 90 s (about a minute of Town income, minus the army)
- Empire Age: 6,500 food, 1,000 gold and 600 stone, 150 s (about 3–4 min of City income after the
  army, techs and second-tier upgrades)

**Gold is the scarce resource.** Each start kit has 800 gold, and about 3,200 lies within 90 tiles
of a Town Center. The scripted player has mined all of that by about minute 18–21. Age gold costs stay
inside that budget, and the Empire Age leans on food. Anything past it has to come from the market
or trade carts.

**Garrisons (M15-3).** Any own land unit takes one slot in a Town Center (10), watch tower (5)
or temple (10, healing only). Each garrisoned villager, archer, slinger or Immortal adds one arrow
to the building's volley (`BALANCE.garrisonArrows`); melee soldiers and cavalry add none. Occupants
heal 1 hp/s (`garrisonHeal`), 3 hp/s in a temple (`garrisonHealBy`). Below 20% of max hp
(`garrisonEjectHp`) a building ejects everyone and takes nobody new.

## Results

From `npm run bench:pacing` after M13-3 (permanent farms, three-tier unit lines, starting
stockpile, 70 villagers, standing army).

### Age times, seeds 1–5

| Seed | Town | City | Empire |
|---|---|---|---|
| 1 | 4:33 | 12:00 | 20:01 |
| 2 | 4:57 | 12:18 | 19:45 |
| 3 | 4:57 | 11:59 | 19:48 |
| 4 | 4:57 | 12:15 | 20:37 |
| 5 | 4:57 | 12:08 | 19:54 |

With the M8-17 costs (`townAge` 400f/60 s, `cityAge` 3800f 800g/150 s, `empireAge` 12000f 1500g
1000s/240 s) and the starting stockpile, the same build order reached Town at about 8:20, City at
about 16:40 and Empire at about 28:30 on seed 1.

### Gather rate over time (seed 1, resources deposited per minute)

| Minute | Age | Villagers + soldiers | Workers f/w/g/s | Food | Wood | Gold | Stone |
|---|---|---|---|---|---|---|---|
| 3 | Village | 16 + 0 | 8/6/0/0 | 395 | 320 | 0 | 0 |
| 5 | Town | 20 + 0 | 7/5/2/0 | 409 | 220 | 60 | 0 |
| 8 | Town | 35 + 5 | 12/13/5/2 | 572 | 439 | 137 | 73 |
| 10 | Town | 50 + 12 | 23/18/5/2 | 1196 | 844 | 169 | 67 |
| 12 | City | 54 + 22 | 21/14/13/3 | 1320 | 646 | 273 | 91 |
| 15 | City | 66 + 37 | 25/17/16/5 | 1404 | 684 | 400 | 245 |
| 20 | City | 70 + 73 | 39/24/0/6 | 2301 | 1223 | 0 | 208 |
| 25 | Empire | 70 + 74 | 38/25/0/5 | 2430 | 1462 | 0 | 108 |

Gold stops at about minute 18–21 because nothing is left within reach. `--verbose` prints every
minute for every seed.

### Economy tech payback (seed 1)

Unchanged by M13-3: the age-up costs don't enter the payback measurement, and every economy tech
still pays back within 5 minutes, so no tech cost changed.

| Tech | Cost | Time | Crew | Gain | Payback |
|---|---|---|---|---|---|
| Bronze Axe | 90f 50w | 25 s | 8 wood | +12.2% | 3:01 |
| Iron Axe | 125f 50g | 45 s | 10 wood | +11.1% | 3:24 |
| Two-Man Saw | 150f 75g | 60 s | 10 wood | +11.5% | 3:58 |
| Bronze Picks | 75f 75w | 30 s | 8 gold | +12.1% | 3:38 |
| Stone Chisels | 75f 75w | 30 s | 6 stone | +19.2% | 3:00 |
| Deep Shafts | 150f 100w | 45 s | 8 gold + 4 stone | +10.8% | 3:53 |
| Ore Sledges | 150f 100w | 50 s | 10 gold + 4 stone | +9.7% | 3:31 |
| Ox Plough | 75f 75w | 25 s | 8 farm | +10.6% | 4:50 |
| Iron Ploughshare | 125f 75w | 45 s | 10 farm | +11.4% | 4:55 |
| Crop Rotation | 150f 100w | 50 s | 10 farm | +13.7% | 4:44 |
| Threshing Floor | 100f 50w | 40 s | 6 berry | +14.0% | 3:48 |
| Donkey Packs | 175f 50w | 50 s | 8 wood + 8 farm + 4 gold | +7.6% | 3:51 |
| Ox Carts | 300f 200w | 75 s | 10 wood + 10 farm + 8 gold | +23.1% | 2:46 |

Village Age techs are judged with 8 workers. Town and City Age techs are judged with 10, because
camps are bigger by then. Census (villagers train 10% faster) isn't in the table because it doesn't
change gather rates. Its value is villagers arriving sooner, and that only matters while the Town
Center is still training. The farm techs are closest to the limit; raise their cost only with care.

### Age costs in M13-3

| Tech | M8-17 | M13-3 |
|---|---|---|
| Town Age | 400f, 60 s | 300f, 45 s |
| City Age | 3800f 800g, 150 s | 1200f 500g, 90 s |
| Empire Age | 12000f 1500g 1000s, 240 s | 6500f 1000g 600s, 150 s |
| Starting stock | none | 200f 200w 100g 100s |

### What changed in `src/core/techs.ts` (M8-17)

| Tech | Before | After |
|---|---|---|
| Town Age | 500f, 60 s | 400f, 60 s |
| City Age | 800f 200g, 90 s | 3800f 800g, 150 s |
| Empire Age | 1000f 800g 200s, 120 s | 12000f 1500g 1000s, 240 s |
| Bronze Axe | 100f 50w | 90f 50w |
| Iron Axe | 200f 100g, 50 s | 125f 50g, 45 s |
| Two-Man Saw | +10%, 300f 200g, 75 s | +20%, 150f 75g, 60 s |
| Bronze Picks / Stone Chisels | 100f 75w | 75f 75w |
| Deep Shafts | 200f 150w, 50 s | 150f 100w, 45 s |
| Ore Sledges | +3 carry, 300f 200w, 60 s | +5 carry, 150f 100w, 50 s |
| Ox Plough | farms worked +10% | +15% (same cost) |
| Iron Ploughshare | +10%, 250f 125w, 50 s | +15%, 125f 75w, 45 s |
| Crop Rotation | +10%, 400f 250w, 70 s | +20%, 150f 100w, 50 s |
| Threshing Floor | 150f 100w | 100f 50w |
| Donkey Packs | 75 s | 50 s (it holds up villager training) |

Later techs in a chain need bigger multipliers for the same absolute gain. Walking time doesn't
shrink, so each speed bonus applies to a smaller part of the trip.

### Sim fix

`ageBuildingsNeeded(age)` in `src/sim/systems/research.ts`: aging up needed two distinct
current-age buildings, but the City Age has only one (the Academy), so the Empire Age could never
be researched. The rule is now "two, or every kind that age has if it has fewer".

## Building upgrades (M14-2)

In-place upgrades (`BUILDING_UPGRADES` in `src/core/buildings.ts`) are priced against the
alternative: building another one. An upgrade costs no builder time, no extra footprint and no
walk, and concentrates hit points and arrows in one spot, so it is deliberately a little worse
per resource than building new. Tiers stack and are applied before research (Masonry,
Fletching and friends still multiply on top).

| Chain | Age | Cost | Time | Adds | Versus building new |
| --- | --- | --- | --- | --- | --- |
| House → Large House | Town | 60 wood, 20 stone | 20 s | hp ×1.5, +5 pop | New house: 30 wood per 5 pop (6/pop). Upgrade: 80 per 5 pop (16/pop), plus 275 hp. Houses stay the cheap default; the upgrade is for a cramped base or a late-game stone sink. |
| Watch Tower → Guard Tower | City | 100 wood, 50 stone | 30 s | hp ×1.4, +1 arrow, +1 range | New tower: 130 per arrow and 900 hp, 45 s of builder time. Guard: 150 per arrow (1.15×) with +360 hp and the extra range. |
| Guard → Fortress Tower | Empire | 50 wood, 175 stone | 45 s | hp ×1.5, +1 arrow, +2/+2 armour | 225 per arrow (1.7× a new tower), paid for by +630 hp and the armour that makes it shrug off archers. Stone-heavy, for the Empire economy. |
| Palisade → Reinforced Palisade | Town | 4 wood, 2 stone | 5 s | hp ×1.5, +1/+1 armour | New segment: 0.021 res/hp. Upgrade: 0.043 res/hp (2×), but it thickens an existing line without a second row. |
| Stone Wall → Fortified Stone Wall | City | 5 stone | 8 s | hp ×1.4, +1/+1 armour | New segment: 0.005 stone/hp. Upgrade: 0.010 stone/hp (2×), same reasoning. Stacks with the academy's Fortified Walls. |
| Town Center → Town Hall | Town | 200 wood, 100 stone | 40 s | hp ×1.15, +1 arrow, +5 garrison | A Town Center can't be built new; compare to a watch tower (130 per arrow, 5 garrison) next to it: 300 buys an arrow, 5 garrison and 360 hp, but the TC trains no villagers for 40 s. |
| Town Hall → City Hall | City | 300 wood, 200 stone, 100 gold | 60 s | hp ×1.15, +1 arrow, +5 garrison, +1/+1 armour | 600 per arrow + garrison + armour; about two Guard Towers' worth of defence in the one building the enemy must kill. |
| City Hall → Imperial Palace | Empire | 400 stone, 250 gold | 80 s | hp ×1.2, +2 arrows, +1/+1 armour | 325 per arrow, the best arrow rate in the chain, because it costs 80 s of villager production in the late game. |
| Barracks / Archery Range / Stable level 2 | City | 150 wood, 100 gold | 40 s | trains 20% faster, hp ×1.1 | A second building (175 wood) doubles throughput; level 2 adds only 20% for 250. Its real value is the gate: the Empire Age unit-line techs (Silver Shields, Champions, Master Archers, Lead-Shot Slingers, Tarantine Horsemen, Clibanarii) need a level-2 building of their kind. |

Guard Tower and Fortress Tower used to be global academy techs (350 and 550 resources for every
tower at once). Per tower they are now cheaper for one or two towers and dearer for a tower
line, which rewards picking the towers that matter. Saves from before M14-2 that researched
them load with every watch tower at the matching tier (`src/sim/serialize.ts`, save v4).
Fortified Town Center (academy-free TC tech, City Age) still exists and stacks with the TC tiers.

## Rerunning

```sh
npm run bench:pacing                          # seeds 1–5 age table + payback table (~4 min)
npm run bench:pacing -- --seeds 2 --verbose   # minute-by-minute workers, gather rates, stockpile
npm run bench:pacing -- --skip ironAxe        # counterfactual: the build order never researches it
npm run bench:pacing -- --no-pacing --techs oxPlough,cropRotation --payback-seed 3
npx vitest run src/bench/pacing.test.ts       # the regression guard (~30 s)
```

The vitest guard runs seed 1 up to the City Age and asserts that Town and City land in their bands.
It also checks that Bronze Axe, Ox Plough, Bronze Picks, Iron Axe and Iron Ploughshare pay back
within 5 minutes, measured over a 180 s window. If you change gather rates, villager costs, the map
kit or tech numbers, rerun the bench and update the tables above.
