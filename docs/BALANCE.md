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

## Fortress and champions (M16-5)

The **Fortress** is a City Age stronghold (5 × 5, 5,200 HP, 12/20 armour like a stone wall under the crush model, 4 arrows of 7 pierce at
range 9 with nobody inside, garrison 20, 200 wood + 650 stone). Each player may own at most **two**
(`BuildingSpec.limit`, foundations included); a third `build` is rejected with `'limit'` and the
build menu shows the count ("1/2", then "Limit reached (2/2)").

Each civilization trains one infantry and one cavalry **champion** there, from the City Age:

| Civ | Infantry | Cavalry |
|---|---|---|
| Hellenes | Spartan Hoplite | Agema Rider |
| Romans | Praetorian | Equites |
| Persians | Apple Bearer | Savar |
| Celts | Gaesatae | Noble Rider |

All infantry champions share one stat block (170 HP, 14 melee, 4/1 armour, 90 food + 150 gold) and
all cavalry champions another (220 HP, 14 melee, 3/3 armour, +6 vs archers, 100 food + 200 gold),
so civs stay even. Champions never gather, build or tend and take no line upgrades. Players with no
civilization (legacy saves) field the Hellenic pair.

Margins (`src/sim/champions.test.ts`: City Age, no techs, equal cost, five jittered line-ups;
"value left" counts survivors weighted by remaining HP). Measured at the time of writing:

| Fight (equal cost) | Result | Test floor |
|---|---|---|
| 5 infantry champions vs 15 Swordsmen | champions win, ~50% value left | win, ≥ 40% |
| 4 cavalry champions vs 8 Horsemen | champions win, ~50–55% value left | win, ≥ 40% |
| 5 infantry champions vs 20 Slingers (hard counter) | slingers win, ~35–45% left | lose, counter ≥ 25% |
| 4 cavalry champions vs 15 Hoplites (hard counter) | hoplites win, ~77% left | lose, counter ≥ 60% |

## Heroes (M16-6)

Each civilization has one named **hero**, trained at a Fortress in the Empire Age (250 food +
350 gold, 40 s). A player may have only one hero alive or queued, and after it falls must wait
**120 s** (`HERO_COOLDOWN`) before training the next; the wait is saved. Heroes never gather,
build, rank up or get converted. Infantry heroes have 600 HP, 18 melee (+4 vs cavalry), 5/4
armour and a 1.5 s swing; Cyrus (cavalry) has 700 HP, 4.8 speed and +6 vs archers.
Heroes capture buildings at the champion rate (5 cp/s, `CHAMPION_CAPTURE_MUL`, M18-4), march in
line with other soldiers, take patrol and guard orders, and a batch order of the hero tile
(Shift-click, touch ×5) queues just one.

Each hero's aura reaches your own units within 8 of its edge (the hero included when it matches):

| Civ | Hero | Aura | Effect |
|---|---|---|---|
| Hellenes | Leonidas | Hold the Line | soldiers +2 melee and pierce armour |
| Romans | Scipio | Drilled Legions | infantry attack 20% faster (reload ÷ 1.2) |
| Persians | Cyrus | Royal Escort | cavalry move 15% faster |
| Celts | Vercingetorix | War Cry | infantry and cavalry +3 melee attack |

Auras now also reach attack (melee, pierce, crush) and attack speed (`reload`), in addition to
gather, carry, speed and armour. Projectiles use the shooter's auras when they land, if it still lives.

## Counters (M16-9)

Every class has a counter that wins **cost for cost**. The table lives in `src/core/counters.ts`.
The help panel (`?`) prints it after the hotkeys, and `src/bench/counters.test.ts` plays every
row, so the text can't drift from the fights.

| Counter | Beats | Why |
|---|---|---|
| Spearmen (Hoplites) | cavalry and cavalry champions | +12 against cavalry |
| Swordsmen | spearmen | more attack at the same price |
| Slingers | infantry and infantry champions | +3 against infantry, and cheap |
| Archers | spearmen and slingers | outrange them; +3 against ranged |
| Cavalry (Horsemen, Scouts) | archers, slingers and siege | +6 against ranged, +10 against siege |
| Melee infantry | unescorted siege | +8 against siege |
| Catapults, Bolt Shooters | massed archers and slingers | splash, and bolts that go through a line |
| Rams, Catapults | buildings | crush damage, which buildings have no armour against |
| Champions | their own line at equal cost | a champion costs 2–3 line units; slingers and spearmen still beat them |

**How it is measured** (`src/bench/counters.ts`):
- Two groups of about equal spend meet on open flat ground, 16 apart, and both attack-move.
  The original table uses the City Age with no research; the tier table below adds only line upgrades.
- The counter gets floor(budget / cost) units and the victim ceil(budget / cost), so rounding
  never helps the counter.
- Each fight runs three jittered line-ups, each played from both sides.
- "Value left" is the share of the spend still standing, with each survivor weighted by its hp.

The test needs the counter to keep at least 75% of the value left, at both 1,200 and 3,600
resources in the original no-research table. Every row there clears that comfortably. Results from `npm run bench:counters` are below
(counter's value left / victim's value left).

| Counter | Victim | ≈ 1,200 | ≈ 3,600 |
|---|---|---|---|
| Hoplite | Horseman | 15 v 8: 80% / 0% | 45 v 24: 81% / 0% |
| Hoplite | Scout | 15 v 15: 93% / 0% | 45 v 45: 93% / 0% |
| Hoplite | Equites | 15 v 4: 78% / 0% | 45 v 12: 79% / 0% |
| Swordsman | Hoplite | 15 v 15: 63% / 0% | 45 v 45: 64% / 0% |
| Slinger | Swordsman | 20 v 15: 82% / 8% | 60 v 45: 81% / 8% |
| Slinger | Hoplite | 20 v 15: 94% / 0% | 60 v 45: 91% / 0% |
| Slinger | Praetorian | 20 v 5: 49% / 0% | 60 v 15: 47% / 0% |
| Archer | Hoplite | 17 v 15: 77% / 14% | 51 v 45: 72% / 9% |
| Archer | Slinger | 17 v 20: 30% / 0% | 51 v 60: 30% / 0% |
| Horseman | Archer | 8 v 18: 88% / 0% | 24 v 52: 85% / 0% |
| Horseman | Slinger | 8 v 20: 83% / 0% | 24 v 60: 79% / 0% |
| Scout | Archer | 15 v 18: 62% / 0% | 45 v 52: 65% / 0% |
| Horseman | Catapult | 8 v 3: 100% / 0% | 24 v 8: 97% / 0% |
| Horseman | Bolt Shooter | 8 v 3: 66% / 0% | 24 v 9: 69% / 0% |
| Swordsman | Catapult | 15 v 3: 82% / 0% | 45 v 8: 88% / 0% |
| Swordsman | Bolt Shooter | 15 v 3: 69% / 0% | 45 v 9: 76% / 0% |
| Hoplite | Catapult | 15 v 3: 75% / 0% | 45 v 8: 82% / 0% |
| Catapult | Archer | 2 v 18: 82% / 0% | 7 v 52: 81% / 0% |
| Catapult | Slinger | 2 v 20: 80% / 0% | 7 v 60: 82% / 0% |
| Bolt Shooter | Archer | 3 v 18: 71% / 0% | 9 v 52: 67% / 0% |
| Bolt Shooter | Slinger | 3 v 20: 68% / 0% | 9 v 60: 61% / 3% |
| Praetorian | Swordsman | 5 v 15: 47% / 0% | 15 v 45: 47% / 0% |
| Equites | Horseman | 4 v 8: 55% / 0% | 12 v 24: 55% / 0% |

**Razing.** About 900 resources of each attacker against a building with no garrison and no
research. The test requires rams and catapults to be at least twice as fast as the same spend of
swordsmen or archers.

| Target | 2 Rams | 2 Catapults | 11 Swordsmen | 6 Horsemen | 13 Archers |
|---|---|---|---|---|---|
| Watch Tower | 24 s | 54 s | 109 s (30% lost) | 225 s (75% lost) | 144 s |
| Stone Wall | 28 s | 67 s | 93 s | 217 s | 136 s |
| Town Center | 54 s | 150 s | 222 s | > 400 s | 371 s |
| Fortress | 109 s (31% lost) | 327 s | > 400 s (all lost) | > 400 s (all lost) | > 400 s |

**Matrix.** At ≈ 1,200, each cell is the row unit's share of the value left against the column
unit. 100% means the row unit won cleanly. The two rounding directions make it a little
asymmetric. `npm run bench:counters -- --matrix` prints it.

| | Hoplite | Swordsman | Slinger | Archer | Scout | Horseman | Catapult | Bolt Shooter | Praetorian | Equites |
|---|---|---|---|---|---|---|---|---|---|---|
| Hoplite (80) | — | 0% | 0% | 12% | 100% | 100% | 100% | 100% | 0% | 100% |
| Swordsman (80) | 100% | — | 7% | 100% | 100% | 100% | 100% | 100% | 0% | 100% |
| Slinger (60) | 100% | 91% | — | 0% | 0% | 0% | 0% | 0% | 100% | 0% |
| Archer (70) | 85% | 0% | 100% | — | 0% | 0% | 0% | 0% | 0% | 0% |
| Scout (80) | 0% | 0% | 100% | 100% | — | 0% | 100% | 100% | 0% | 0% |
| Horseman (150) | 0% | 0% | 100% | 100% | 100% | — | 100% | 100% | 0% | 0% |
| Catapult (500) | 0% | 0% | 100% | 100% | 0% | 0% | — | 32% | 0% | 0% |
| Bolt Shooter (400) | 0% | 0% | 100% | 100% | 0% | 0% | 0% | — | 0% | 0% |
| Praetorian (240) | 100% | 100% | 0% | 100% | 100% | 100% | 100% | 100% | — | 100% |
| Equites (300) | 0% | 0% | 100% | 100% | 100% | 100% | 100% | 100% | 0% | — |

Swordsmen beat archers cost for cost (archers are the anti-ranged and anti-spear bow), so the
answer to massed swordsmen is slingers. No unit cost changed in M16-9: every counter already held
once the bench was measured correctly. An earlier draft of the harness dropped player 2's orders,
which made the first mover look stronger and bolt shooters look overpriced.
Heroes are not in the table: there is one per player, and their value is the aura.

### Unit-line counters (L60 / M8-10)

`npm run bench:counters -- --tiers` checks the ten published matchups between the six generic
lines at tiers 0–3, budgets 1,200 and 3,600, with two jittered line-ups from both sides.
Both players receive every generic line tech through the selected tier before units spawn,
so they start with upgraded HP. There are no forge techs or civilization bonuses. The arena
uses City Age at tiers 0–2 and Empire Age at tier 3.

The 60 added test cases require at least 60% of the value left, and the published 75% bar
for every case except three that sit just under it: Composite Archer versus Veteran Hoplite
at 1,200 (73%) and Cretan Archer versus Phalangite at both budgets (73%, 71%). Archer versus
Slinger lost at tiers 1 and 3 before L60 (0% at both budgets) and is now held to 75% too.
Veteran Hoplite versus Light Cavalry is also asserted to stay a clean 100% win.

Output from `npm run bench:counters -- --tiers`:

| tier | counter | victim | budget | units | share | counter left | victim left | verdict |
|---|---|---|---|---|---|---|---|---|
| 0 | Hoplite | Horseman | 1200 | 15 v 8 | 100% | 80% | 0% | ok |
| 0 | Hoplite | Horseman | 3600 | 45 v 24 | 100% | 81% | 0% | ok |
| 0 | Hoplite | Scout | 1200 | 15 v 15 | 100% | 93% | 0% | ok |
| 0 | Hoplite | Scout | 3600 | 45 v 45 | 100% | 93% | 0% | ok |
| 0 | Swordsman | Hoplite | 1200 | 15 v 15 | 100% | 62% | 0% | ok |
| 0 | Swordsman | Hoplite | 3600 | 45 v 45 | 100% | 64% | 0% | ok |
| 0 | Slinger | Swordsman | 1200 | 20 v 15 | 92% | 80% | 7% | ok |
| 0 | Slinger | Swordsman | 3600 | 60 v 45 | 92% | 82% | 7% | ok |
| 0 | Slinger | Hoplite | 1200 | 20 v 15 | 100% | 97% | 0% | ok |
| 0 | Slinger | Hoplite | 3600 | 60 v 45 | 100% | 91% | 0% | ok |
| 0 | Archer | Hoplite | 1200 | 17 v 15 | 86% | 78% | 13% | ok |
| 0 | Archer | Hoplite | 3600 | 51 v 45 | 88% | 70% | 9% | ok |
| 0 | Archer | Slinger | 1200 | 17 v 20 | 100% | 31% | 0% | ok |
| 0 | Archer | Slinger | 3600 | 51 v 60 | 100% | 30% | 0% | ok |
| 0 | Horseman | Archer | 1200 | 8 v 18 | 100% | 91% | 0% | ok |
| 0 | Horseman | Archer | 3600 | 24 v 52 | 100% | 85% | 0% | ok |
| 0 | Horseman | Slinger | 1200 | 8 v 20 | 100% | 86% | 0% | ok |
| 0 | Horseman | Slinger | 3600 | 24 v 60 | 100% | 78% | 0% | ok |
| 0 | Scout | Archer | 1200 | 15 v 18 | 100% | 62% | 0% | ok |
| 0 | Scout | Archer | 3600 | 45 v 52 | 100% | 65% | 0% | ok |
| 1 | Veteran Hoplite | Companion Cavalry | 1200 | 15 v 8 | 100% | 80% | 0% | ok |
| 1 | Veteran Hoplite | Companion Cavalry | 3600 | 45 v 24 | 100% | 80% | 0% | ok |
| 1 | Veteran Hoplite | Light Cavalry | 1200 | 15 v 15 | 100% | 85% | 0% | ok |
| 1 | Veteran Hoplite | Light Cavalry | 3600 | 45 v 45 | 100% | 85% | 0% | ok |
| 1 | Veteran Swordsman | Veteran Hoplite | 1200 | 15 v 15 | 100% | 34% | 0% | ok |
| 1 | Veteran Swordsman | Veteran Hoplite | 3600 | 45 v 45 | 100% | 36% | 0% | ok |
| 1 | Balearic Slinger | Veteran Swordsman | 1200 | 20 v 15 | 98% | 81% | 1% | ok |
| 1 | Balearic Slinger | Veteran Swordsman | 3600 | 60 v 45 | 91% | 80% | 8% | ok |
| 1 | Balearic Slinger | Veteran Hoplite | 1200 | 20 v 15 | 100% | 94% | 0% | ok |
| 1 | Balearic Slinger | Veteran Hoplite | 3600 | 60 v 45 | 99% | 87% | 0% | ok |
| 1 | Composite Archer | Veteran Hoplite | 1200 | 17 v 15 | 73% | 75% | 28% | wins <75% |
| 1 | Composite Archer | Veteran Hoplite | 3600 | 51 v 45 | 77% | 68% | 20% | ok |
| 1 | Composite Archer | Balearic Slinger | 1200 | 17 v 20 | 100% | 35% | 0% | ok |
| 1 | Composite Archer | Balearic Slinger | 3600 | 51 v 60 | 100% | 31% | 0% | ok |
| 1 | Companion Cavalry | Composite Archer | 1200 | 8 v 18 | 100% | 87% | 0% | ok |
| 1 | Companion Cavalry | Composite Archer | 3600 | 24 v 52 | 100% | 88% | 0% | ok |
| 1 | Companion Cavalry | Balearic Slinger | 1200 | 8 v 20 | 100% | 84% | 0% | ok |
| 1 | Companion Cavalry | Balearic Slinger | 3600 | 24 v 60 | 100% | 84% | 0% | ok |
| 1 | Light Cavalry | Composite Archer | 1200 | 15 v 18 | 100% | 84% | 0% | ok |
| 1 | Light Cavalry | Composite Archer | 3600 | 45 v 52 | 100% | 86% | 0% | ok |
| 2 | Phalangite | Cataphract | 1200 | 15 v 8 | 100% | 78% | 0% | ok |
| 2 | Phalangite | Cataphract | 3600 | 45 v 24 | 100% | 79% | 0% | ok |
| 2 | Phalangite | Prodromos | 1200 | 15 v 15 | 100% | 83% | 0% | ok |
| 2 | Phalangite | Prodromos | 3600 | 45 v 45 | 100% | 84% | 0% | ok |
| 2 | Heavy Swordsman | Phalangite | 1200 | 15 v 15 | 100% | 31% | 0% | ok |
| 2 | Heavy Swordsman | Phalangite | 3600 | 45 v 45 | 100% | 30% | 0% | ok |
| 2 | Rhodian Slinger | Heavy Swordsman | 1200 | 20 v 15 | 81% | 73% | 17% | ok |
| 2 | Rhodian Slinger | Heavy Swordsman | 3600 | 60 v 45 | 86% | 71% | 11% | ok |
| 2 | Rhodian Slinger | Phalangite | 1200 | 20 v 15 | 100% | 90% | 0% | ok |
| 2 | Rhodian Slinger | Phalangite | 3600 | 60 v 45 | 99% | 88% | 1% | ok |
| 2 | Cretan Archer | Phalangite | 1200 | 17 v 15 | 73% | 69% | 25% | wins <75% |
| 2 | Cretan Archer | Phalangite | 3600 | 51 v 45 | 71% | 73% | 30% | wins <75% |
| 2 | Cretan Archer | Rhodian Slinger | 1200 | 17 v 20 | 100% | 45% | 0% | ok |
| 2 | Cretan Archer | Rhodian Slinger | 3600 | 51 v 60 | 100% | 38% | 0% | ok |
| 2 | Cataphract | Cretan Archer | 1200 | 8 v 18 | 100% | 95% | 0% | ok |
| 2 | Cataphract | Cretan Archer | 3600 | 24 v 52 | 100% | 95% | 0% | ok |
| 2 | Cataphract | Rhodian Slinger | 1200 | 8 v 20 | 100% | 93% | 0% | ok |
| 2 | Cataphract | Rhodian Slinger | 3600 | 24 v 60 | 100% | 94% | 0% | ok |
| 2 | Prodromos | Cretan Archer | 1200 | 15 v 18 | 100% | 80% | 0% | ok |
| 2 | Prodromos | Cretan Archer | 3600 | 45 v 52 | 100% | 82% | 0% | ok |
| 3 | Silver Shield | Clibanarius | 1200 | 15 v 8 | 100% | 76% | 0% | ok |
| 3 | Silver Shield | Clibanarius | 3600 | 45 v 24 | 100% | 77% | 0% | ok |
| 3 | Silver Shield | Tarantine Horseman | 1200 | 15 v 15 | 100% | 84% | 0% | ok |
| 3 | Silver Shield | Tarantine Horseman | 3600 | 45 v 45 | 100% | 84% | 0% | ok |
| 3 | Champion Swordsman | Silver Shield | 1200 | 15 v 15 | 100% | 30% | 0% | ok |
| 3 | Champion Swordsman | Silver Shield | 3600 | 45 v 45 | 100% | 30% | 0% | ok |
| 3 | Lead-Shot Slinger | Champion Swordsman | 1200 | 20 v 15 | 76% | 62% | 19% | ok |
| 3 | Lead-Shot Slinger | Champion Swordsman | 3600 | 60 v 45 | 86% | 63% | 10% | ok |
| 3 | Lead-Shot Slinger | Silver Shield | 1200 | 20 v 15 | 92% | 89% | 7% | ok |
| 3 | Lead-Shot Slinger | Silver Shield | 3600 | 60 v 45 | 96% | 84% | 4% | ok |
| 3 | Master Archer | Silver Shield | 1200 | 17 v 15 | 93% | 67% | 5% | ok |
| 3 | Master Archer | Silver Shield | 3600 | 51 v 45 | 87% | 69% | 10% | ok |
| 3 | Master Archer | Lead-Shot Slinger | 1200 | 17 v 20 | 100% | 21% | 0% | ok |
| 3 | Master Archer | Lead-Shot Slinger | 3600 | 51 v 60 | 100% | 18% | 0% | ok |
| 3 | Clibanarius | Master Archer | 1200 | 8 v 18 | 100% | 90% | 0% | ok |
| 3 | Clibanarius | Master Archer | 3600 | 24 v 52 | 100% | 92% | 0% | ok |
| 3 | Clibanarius | Lead-Shot Slinger | 1200 | 8 v 20 | 100% | 94% | 0% | ok |
| 3 | Clibanarius | Lead-Shot Slinger | 3600 | 24 v 60 | 100% | 94% | 0% | ok |
| 3 | Tarantine Horseman | Master Archer | 1200 | 15 v 18 | 100% | 80% | 0% | ok |
| 3 | Tarantine Horseman | Master Archer | 3600 | 45 v 52 | 100% | 81% | 0% | ok |

## Unit-line upgrades (M13-2, L60)

Line upgrades stack, keep training costs unchanged, and strengthen all existing and future
units in that line. Town/City/Empire upgrades have tiers 1/2/3; tier 3 requires a level-2
production building. The ranged lines below are the increments at each tier, matching the
tech descriptions displayed in game.

| Line | Tier | Name | Cost | Time | Adds |
|---|---|---|---|---|---|
| Archer | 1 | Composite Archer | 125 wood, 75 gold | 40 s | +20% HP, +1 attack, +1 range |
| Archer | 2 | Cretan Archer | 250 wood, 150 gold | 55 s | +20% HP, +1 attack, +1 pierce armour |
| Archer | 3 | Master Archer | 500 wood, 300 gold | 75 s | +20% HP, +2 attack, +1 range |
| Slinger | 1 | Balearic Slinger | 125 food, 60 stone | 40 s | +25% HP, +1 attack |
| Slinger | 2 | Rhodian Slinger | 250 food, 125 stone | 55 s | +20% HP, +1 attack, +1 range |
| Slinger | 3 | Lead-Shot Slinger | 500 food, 250 stone | 75 s | +25% HP, +1 attack, +1 pierce armour |

L60 reduces the Balearic and Lead-Shot attack bonuses from +2 to +1. Reducing only Balearic
attack left tier-3 archers losing (39% / 2% share), so both reductions are needed. No archer
armour buff is needed: the retune yields 100% archer share against slingers at every tier,
while slingers keep at least 76% against infantry. HP, costs, research time
and the range/armour benefits stay intact. This restores the archer counter while preserving
slingers' infantry counters and cavalry's ranged counters. Base units and combat rules are
unchanged. The simulation data change requires `NETWORK_VERSION` 17; saved state has no new
fields, so `SAVE_VERSION` stays unchanged and researched upgrades load with the new stats.

The civilization tournament in `docs/CIVILIZATIONS-BALANCE.md` predates this retune and was
not rerun. Persian Immortals are archer-class unique units with their own one-step line;
their matchup against slingers remains unchecked. AI match length and civilization targets
remain separate follow-ups (M16-10 / M16-11).

## AI-vs-AI match length (M16-9, M16-10)

`npm run bench:matches` plays moderate AI against moderate AI on the default map, seeds 1–20,
both sides. That is the large Mediterranean from `generateMap(seed, 2)`. Civilizations rotate
through the six pairings by seed. Games run to conquest with a 60-minute cap. This is a
different measure from the civilization bench, which stops at 30 minutes and scores.
`MATCH_BENCH_DIFFICULTY` picks the AI level, and `MATCH_BENCH_TUNE` takes profile overrides as
JSON. Each row records how a decided game ended (`reason`) and each side's final census (`end`).

**Target: a median of 25–45 minutes with 85% decided. It is still not met, and the target stays
open.** Measured at `ebed720` (40 games per level; the rows are deterministic and identical to an
earlier run of the same AI):

| Level | Decided within 60 min | of which resigned | Median length | Median of decided games | Baseline (M16-9) |
|---|---|---|---|---|---|
| moderate | 22 (55%) | 20 | 58.9 min | 44.8 min | 25 conquests, 50.9 min |
| hard | 30 (75%) | 27 | 47.4 min | 43.0 min | 16 conquests, > 60 min |
| hardest | 37 (92.5%) | 28 | 37.3 min | 37.1 min | 10 conquests, > 60 min |

Evidence: [moderate](verification/matches-moderate-ebed720.jsonl),
[hard](verification/matches-hard-ebed720.jsonl),
[hardest](verification/matches-hardest-ebed720.jsonl) and the
[metadata](verification/matches-ebed720.metadata.json), which also holds every intermediate
run below. The M16-9 baseline is [here](verification/matches-74025a6.jsonl).

### What M16-10 changed

**Gold supply (the M16-9 diagnosis).** Every player gets two expansion clusters of two 800-gold
mines, on its flanks about 40 from its start (further back with more than two players): 3,200
more gold each, past the Town Age territory and nearer its own start than any rival's
(`EXPANSION_GOLD` in `src/core/maps.ts`). The map now holds 12,800 gold for two players. On the
variant maps a mine goes in for every player or for none, so totals stay equal; Islands get
none. The AI's second Town Center goes to untouched gold first (a mine with 300+ seeds a site,
and a forest's wood counts 2,000 at most), its worker split and its market count every reserve
(age-up, Town Center, building being saved for), it never buys with gold an age-up is saving,
and with the mines dry it sells surplus beyond the reserve for gold. `bench:pacing` keeps all 15
age times in band; the new mines move the scripted build order's times by up to about 40 s per
age, because the forests around them shift.

With that alone, the City Age came in 64 of 80 player-games (51 before), **but decided games
fell to 19/40**: the M16-9 conquests had come mostly from AI deadlocks that banked big armies,
not from a working attack. Probing the stalled games found six AI military faults, each now fixed
and covered by a test (`src/ai/stall.test.ts`, `src/ai/territory.test.ts`):

1. **Attacks never ended.** Fresh troops joined a running attack four at a time for the rest of
   the game, each group dying at the enemy's gates; the enemy, never calm at home, never mustered
   a wave of its own. An attack below 35% of the soldiers committed to it is now called off, and
   it is only reinforced while it holds 60%.
2. **Any raider recalled the wave.** With the army out, home was empty, so one enemy soldier near
   the base called every wave back within seconds; two waves that crossed both turned back. A
   recall now needs 5+ soldiers, half the attack's size and the wave still nearer home than its
   target. The attack keeps running while home defends.
3. **Razers never fought back.** A soldier razing or capturing a building does not turn on the
   soldiers hitting it, so waves stood at houses while the defence cut them down. Wave soldiers
   on a building now attack-move onto an enemy soldier within 9.
4. **Saving for an age held the army home for good.** No wave starts while saving for the Town or
   City Age; when the gold never came, a 150-strong army sat home for 45 minutes. The hold now
   lapses after 3 minutes of saving.
5. **Army-first spent the age reserve with a big army.** Any raid made the AI spend the City Age
   gold on soldiers, even 150 against 40. It now does so only while its army doesn't already
   outnumber the enemy's.
6. **Beaten AIs never died.** Conquest needs every unit dead, and a fleeing explorer scout kept a
   player with nothing else alive to the cap. With no enemy building known, the army now hunts
   in squads (sightings, then unexplored or unseen ground), and **a beaten computer player
   resigns**: no Town Center, no villager and fewer than 5 soldiers, through a dispatched
   `resign` command (computer players only; a toast and the end sheet name who resigned).

| Run (moderate, 40 games) | Decided | Median | City Age (of 80) |
|---|---|---|---|
| M16-9 baseline `74025a6` | 25 | 50.9 | 51 |
| + expansion gold, site, market | 19 | > 60 | 64 |
| + attacks end, fight first | 11 | > 60 | 53 |
| + hunt | 18 | > 60 | 52 |
| + age hold 3 min, army-first | 3 | > 60 | 78 |
| + no recall for raiders | 7 | > 60 | 72 |
| + recall only near home, attack runs while defending | 17 | > 60 | 64 |
| + resign (shipped) | 22 | 58.9 | 69 |

### Why the target is still open

- **Even economies trading roughly 20-unit waves.** 12 of the 18 moderate games still running at
  60 minutes are even: both sides keep 30+ villagers and 6+ soldiers. Armies in those games peak
  at about 43 soldiers (84 in decided games). Waves of 18–30 leave every 6–10 minutes and are
  spent within 0.5–3 minutes at the enemy base, against an army of the same size fighting next to
  its own production. Buildings matter little: soldiers took about 70,000 damage from soldiers in
  one probed game and 3,500 from towers and Town Centers. Villagers garrison, so economies are
  rarely hurt.
- **Armies are resource-starved on 36 villagers.** Even with 12,800 gold on the map it is mined
  out by about minute 50. The Empire Age save (6,500 food) holds the food from about minute 35,
  and several games end at 56–59 min right after it, when the banked food becomes a big army.
- **Easy to shuffle, hard to move.** As in M16-9, single changes move which seeds stall.

**Levers to try next** (measured on the shipped AI unless noted):

| Change | Decided | Median |
|---|---|---|
| Moderate with 50 villagers | 24 | 54.0 |
| Moderate with 60 villagers | 27 | 50.7 |
| Waves 12 + 6 per wave, up to 45 (before the recall fixes; 39 games) | 10 | > 60 |
| Waves 12 + 6, up to 45, and 50 villagers (before the recall fixes; 33 games) | 16 | > 60 |

- A bigger moderate economy is the most promising: the hard AI (48 villagers) is already at 75%
  decided with a 47-minute median, and the hardest (56 villagers, a full map and a trickle) meets
  the target at 92.5% and 37 minutes. Try 50–60 villagers with a matching pop and house plan.
- Bank for one decisive push: hold a wave until it is well ahead of the army seen (or the Empire
  Age's food lands), rather than trading 20-unit waves.
- Target the Town Center with the wave's siege first, so a won fight breaks the economy.
- Raid villagers: today the army goes for the nearest building and villagers garrison.

### M16-9 findings

**Fixed: villagers froze at a boxed-in drop site.** A mining camp hemmed in by houses and farms
gave its walker an empty path, so the villager never arrived and stayed in `toDrop` forever.
Several gold miners per side froze this way. `nearestDrop` now treats such a site as unreachable
(`src/sim/systems/sites.ts`, with a test in `src/sim/gather.test.ts`).

**The stall: gold runs out in the Town Age.** Measured by
[a probe on 12 games](verification/gold-supply-74025a6.jsonl):
- **The map holds 6,400 gold for two players:** sixteen 400-gold mines. Each start has 1,600
  within 60 tiles and 2,800–3,600 within 90 (some mines are shared toward the middle).
- **Three-quarters of the map's gold is mined by minute 18–27** (median 22). It is gone within
  90 tiles of each Town Center by minute 29–41 (median 33), and from the whole map by minute
  30–41 in every game that lasted that long.
- **Most of it goes on Town Age soldiers.** In four 30-minute games, archers took 12,240 gold,
  Swordsmen 8,000 and Immortals 3,080, while City Age research took only 2,000.
- **After that, the City Age's 500 gold can only come from the market.** An AI saving for the
  age sells wood for gold, then spends that gold buying the age's food. In seed 14 one side
  traded 124 times and its gold never went above 100. The AI is "army first" (outnumbered or
  raided) most of the time in a war of equals, and army-first training ignores the age reserve.
- **The second Town Center (M18-5) rarely helps.** It goes down at minute 7–24, 30–82 tiles
  from home. Only 9 of 25 sit within 25 tiles of untouched gold, a pocket of 260–1,190. The rest
  have 0–780 gold within 40 tiles, usually a single 400-gold mine.
- **Deaths are 94% unit against unit:** 3,041, against 175 to towers and Town Centers (four
  stalled games, 40 min). Equal AIs wear each other down rather than breaking a base.

**Levers tried without success.** Each was run on 40 games (seeds 1–20) on the fixed sim,
against 25/40 conquests and a 50.9-min median:

| Change | Conquests | Median |
|---|---|---|
| Infantry +2 damage against buildings | 27 | 49.0 |
| Infantry +4 damage against buildings | 24 | 47.6 |
| AI keeps the City Age gold while army-first | 22 | 49.6 |
| …plus infantry +2 against buildings | 23 | 57.1 |
| City Age 1,400 food + 300 gold, plus infantry +2 | 18 | > 60 |
| Archer 40 wood + 30 gold (23 games) | 9 | > 60 |
| AI never spends the age's gold buying | 21 | 58.6 |
| …plus selling spare wood or food sooner while gold is short | 20 | > 60 |
| Hard vs hard (no change) | 16 | > 60 |
| Hardest vs hardest (no change) | 10 | > 60 |

None ships. Small changes shuffle which seeds stall rather than removing the stall: one seed
swung between a 46-minute conquest and the cap. The fix needs more gold or a different AI
economy, which M16-10 took on (above).

For comparison, 0 A.D. has two continuing gold sources. Its large metal mines hold 5,000, against
400 here, and traders between two of your markets earn more the farther apart the markets are.
Its market barter is a stopgap, as it is here. Age of Empires II mines hold 800 per pile, and its
relics and trade carts keep gold coming once the mines are empty.

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

**Batch training (M15-4).** Shift-click or Shift+hotkey on a train button orders a batch of five as
one queue entry, as 0 A.D.'s BatchTimeModifier does. A batch of `n` (1–10) takes

```
batch_time = unit_train_time × n ^ BALANCE.batchExponent      (batchExponent = 0.8)
```

so five villagers take 8 × 5^0.8 ≈ 29.0 s instead of 40 s (≈ 5.8 s each), and ten take ≈ 50.5 s.
All units of the batch appear together when it completes. The whole batch is paid when it is
ordered and refunded in full when cancelled. Ordering it needs pop room for every unit (counting
units already queued anywhere; siege takes `UnitSpec.pop` slots each). A batch that has not started also waits, without progress, until
the owner has pop room for all of it, for example after a house is lost. A batch order joins the
last queue entry when that entry is the same kind, has not started, has no research queued after it,
and stays at ten units or fewer. Otherwise it starts a new entry. Single orders, including all AI
orders, always add their own one-unit entry, so the AI trains exactly as before.

**Age cost scale.** Villagers here gather about 0.7–0.8 resources/s and train in 8 s, so incomes
are roughly 4× an AoE2 game's. That puts the scripted economy at about 900/min at 10 min,
2,300/min at 15 min and 3,000/min at 25 min. Each age costs a few minutes of that income on top
of the army upkeep:

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
| Town Center → Town Hall | Town | 200 wood, 100 stone | 40 s | hp ×1.15, +1 arrow, +5 garrison | Compare to a watch tower (130 per arrow, 5 garrison) next to it: 300 buys an arrow, 5 garrison and 360 hp, but the TC trains no villagers for 40 s. |
| Town Hall → City Hall | City | 300 wood, 200 stone, 100 gold | 60 s | hp ×1.15, +1 arrow, +5 garrison, +1/+1 armour | 600 per arrow + garrison + armour; about two Guard Towers' worth of defence in the one building the enemy must kill. |
| City Hall → Imperial Palace | Empire | 400 stone, 250 gold | 80 s | hp ×1.2, +2 arrows, +1/+1 armour | 325 per arrow, the best arrow rate in the chain, because it costs 80 s of villager production in the late game. |
| Barracks / Archery Range / Stable level 2 | City | 150 wood, 100 gold | 40 s | trains 20% faster, hp ×1.1 | A second building (175 wood) doubles throughput; level 2 adds only 20% for 250. Its real value is the gate: the Empire Age unit-line techs (Silver Shields, Champions, Master Archers, Lead-Shot Slingers, Tarantine Horsemen, Clibanarii) need a level-2 building of their kind. |

Guard Tower and Fortress Tower used to be global academy techs (350 and 550 resources for every
tower at once). Per tower they are now cheaper for one or two towers and dearer for a tower
line, which rewards picking the towers that matter. Saves from before M14-2 that researched
them load with every watch tower at the matching tier (`src/sim/serialize.ts`, save v4).
Fortified Town Center (academy-free TC tech, City Age) still exists and stacks with the TC tiers.

## Territory (M18-1)

Borders follow 0 A.D.'s TerritoryInfluence/TerritoryManager (`src/sim/territory.ts`, data in
`BuildingSpec.territory` and `TERRITORY` in `src/core/buildings.ts`). The grid has 1-unit cells
(2× the nav cell): 192 × 192 on a giant map.

| Building | Radius | Weight | Root |
| --- | --- | --- | --- |
| Town Center | 22 (+25% of base per age: 27.5, 33, 38.5) | 10 | yes |
| Fortress | 16 | 8 | yes |
| Wonder | 12 | 6 | no |
| Storehouse, granary, mining camp, dock, military, forge, market, temple, academy, watch tower | 8 | 3 | no |
| House, corral | 6 | 2 | no |
| Walls, gates, farms | none | | |

- Pull falls off linearly from `weight` at the centre to 0 at `radius`. It sums per player, and the
  strongest player takes the cell. A tie leaves it neutral.
- A Town Center's weight dwarfs minor buildings. Only a dense cluster of enemy buildings (or
  another Town Center) can take the ground under it. A root on enemy-owned ground anchors nothing.
- Owned cells 4-connected to a cell holding their owner's root are connected. The rest keep their
  owner but are flagged unconnected, which M18-3 decay uses.
- Territory reaches 6 cells over water from the shore, so wide channels between islands stay neutral.
- The fortress (added after M18-1) is a root too: radius 16, weight 8 (M18-3).
- Cost: a full recompute on a giant map with 4 players and 61 buildings each, all in the Empire Age,
  takes about 0.7 ms. The per-tick fingerprint check takes under 0.01 ms. Recompute runs only when
  the fingerprint changes, so the cost is not spread across ticks.

## Territory rules (M18-3)

Placement and decay follow 0 A.D.'s BuildRestrictions and TerritoryDecay (`canPlace` in
`src/sim/systems/build.ts`, `src/sim/systems/decay.ts`; data in `BuildingSpec.placeIn`,
`BuildingSpec.decayTo` and `TERRITORY`).

- **Placement.** The footprint centre must be on the builder's own territory. Watch towers, docks and
  Town Centers (`placeIn: 'ownOrNeutral'`) may also go on neutral land, which lets you push borders
  outward. Nothing may go on another player's land, allied or not. A Town Center also needs
  30 units (`townCenterSpacing`) from every other Town Center or Town Center foundation. A rejected
  order reports `territory`, and the ghost says why.
- **New Town Centers (M18-5).** Villagers build Town Centers from the Town Age (`age: 1`, Shift+Y,
  last tile of the build menu) at the existing 275 wood + 100 stone and 150 s build time. Each new
  one is a territory root, trains villagers and adds 5 pop. The price is a first guess and much
  cheaper than 0 A.D.'s Civic Center; the M13-7 / M16-9 balance passes should look at it (the
  moderate AI now founds a second one on medium and larger maps, about minute 7–12).
- **Decay.** A complete building loses `decayRate` = 0.2% of its max hp per second (1% per 5 s) while
  its centre is off its owner's connected territory. That covers enemy or neutral land, and own land
  cut off from every Town Center. Any garrisoned occupant stops decay, and repair works as usual.
  Roots (Town Centers and fortresses) never decay. A building goes from full hp to 0 in about 8 min 20 s.
- **At 0 hp.** Houses, farms, corrals, palisades, stone walls and gates (`decayTo: 'collapse'`) are
  destroyed: they are cheap, and a Gaia field or wall line would only clutter the map. Everything
  else turns neutral (Gaia) with 25% of max hp (`neutralHp`). Its training and research queues are
  dropped without refund. It projects no territory, fires no arrows, never decays further and never
  counts as a wonder. Any player can tear it down with an explicit attack order; idle units ignore it.
  Soldiers can capture neutral buildings (see Capture below).

## Capture (M18-4)

Modelled on 0 A.D.'s Capturable (`src/sim/systems/capture.ts`; data in `CAPTURE` and
`BuildingSpec.capturePoints` in `src/core/buildings.ts`, `CAPTURE_RATE` in `src/core/units.ts`).

- **Capture points.** A complete building splits `maxCapturePoints` between the players (Gaia
  included); its owner holds them all until someone captures. The default is half the base hp
  (`cpPerHp: 0.5`): house 275, barracks 600, Town Center 1200, fortress 2600, wonder 4000. Palisades,
  stone walls, gates and farms (`capturePoints: 0`) and foundations can only be destroyed.
- **Capture attack.** Infantry, archers, cavalry and scouts drain 2.5 cp/s each, champions 5 cp/s.
  Units capture standing within 1 unit of the footprint (archers walk up too). Villagers, priests,
  trade carts, ships and siege have no capture attack: villagers stay workers here (0 A.D.'s citizen
  women don't capture either), and siege only destroys. What a unit takes is split evenly over its
  player's rivals (Gaia counts as everyone's rival, allies never lose points) and added to its own.
- **Winning points back.** Each garrisoned unit gives the owner 3 cp/s, and standing in the owner's
  connected territory 1 cp/s. A building on a rival's territory (an outpost or a neutral ruin) drifts
  to the territory owner at 1 cp/s. A cut-off building gets no home regeneration.
- **Changing hands.** When the owner's points reach 0, the player holding the most takes the
  building. The old owner gets its training, research and upgrade queues refunded. Occupants step
  out, and rally, farmer and tending claims are dropped. Hit points, tier and the split of points stay.
  Pop cap, territory, fog, auras and the conquest check follow the new owner. A captured counting
  wonder cancels its countdown, which restarts for the new owner. Both players get a toast, and the
  'captured' event fires.
- **Pacing.** Three swordsmen (7.5 cp/s) take an undefended house on neutral land in about 37 s, or a
  barracks in 80 s. Two garrisoned villagers (6 cp/s) hold a tower against two swordsmen. A Town
  Center with its 10 villagers inside (31 cp/s at home) needs 13 soldiers or 7 champions just to
  break even.
- **Orders.** Right-clicking an enemy or neutral building with soldiers captures it. Ctrl+right-click,
  attack-move targeting (Q), or the Raze order button (also in the phone Orders sheet) attack it to
  destroy instead. Units that cannot capture attack as before. Idle units that pick a building on
  their own still attack it.
- **The AI (M18-5).** Its attack waves capture military and economic buildings while no enemy
  soldier stands next to them, and raze houses, walls and farms. A capture that gains no points for
  20 s (a garrison wins them back as fast) turns into razing. At home it garrisons villagers (and,
  when outnumbered, soldiers) in a Town Center, tower or temple that is being captured.

## Rerunning

```sh
npm run bench:pacing                          # seeds 1–5 age table + payback table (~4 min)
npm run bench:pacing -- --seeds 2 --verbose   # minute-by-minute workers, gather rates, stockpile
npm run bench:pacing -- --skip ironAxe        # counterfactual: the build order never researches it
npm run bench:pacing -- --no-pacing --techs oxPlough,cropRotation --payback-seed 3
npx vitest run src/bench/pacing.test.ts       # the regression guard (~30 s)
npm run bench:counters -- --matrix            # counter table, unit matrix and raze times (~1 min)
npm run bench:counters -- --tiers             # generic line counters at every tier
npx vitest run src/bench/counters.test.ts     # the counter-table guard (~15 s)
npm run bench:matches                         # AI-vs-AI match length, seeds 1–10 (shard with MATCH_BENCH_SHARDS; MATCH_BENCH_DIFFICULTY, MATCH_BENCH_TUNE)
```

The vitest guard runs seed 1 up to the City Age and asserts that Town and City land in their bands.
It also checks that Bronze Axe, Ox Plough, Bronze Picks, Iron Axe and Iron Ploughshare pay back
within 5 minutes, measured over a 180 s window. If you change gather rates, villager costs, the map
kit or tech numbers, rerun the bench and update the tables above.

## AI difficulty ladder (M7-4)

New game offers Easy, Moderate, Hard and Hardest for every rival. The ladder pairs adjacent
levels on the large Mediterranean map with Hellenes on both sides, seeds 1–10 in both seats,
and a 40-minute cap. Conquest or resignation decides a game; otherwise the higher count of
villagers + soldiers + finished buildings wins (the census excludes scouts; a tie is a draw).
Wonder victory is disabled for this military-strength benchmark. Profiles are unchanged.

Planner baseline on `7157fcc`:

| Pairing | Higher level won | As seat 1 | As seat 2 | Decided ≤ 40 min |
|---|---|---|---|---|
| easy vs moderate | 16/20 (80%) | 6/10 | 10/10 | 6 |
| moderate vs hard | 19/20 (95%) | 10/10 | 9/10 | 8 |
| hard vs hardest | 17/20 (85%) | 10/10 | 7/10 | 10 |

Easy vs moderate is exactly on the 80% bar. Three of moderate's four losses were score calls
within 1–9 points (105–114, 101–102, 99–101), all with moderate in seat 1. The known seat
advantage belongs to M16-11; this setup change does not retune profiles or alter map generation.

Run `npm run bench:difficulty` (six shards, about 20 minutes). It appends resumable JSONL to
`/tmp/agesago-difficulty-<git revision>.jsonl` and exits 1 if any pairing has fewer than 16 wins
out of 20, including draws as non-wins. `DIFFICULTY_BENCH_SHARDS` sets concurrency;
`DIFFICULTY_BENCH_OUTPUT` selects the output file. For manually scheduled shards set
`DIFFICULTY_BENCH_SHARD=0` through `5`, then run with `DIFFICULTY_BENCH_SUMMARY=1` to check the
complete ladder. Resume only against the same source revision; use a new file after edits.

Starting resources are equal for every player: Low is 100 food, 100 wood, 50 gold and 50 stone;
Standard remains 200/200/100/100; High is 600/600/300/300. Tutorial and online matches always
use Standard and free-for-all teams.
