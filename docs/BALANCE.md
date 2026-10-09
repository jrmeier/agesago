# Progression balance (M8-17)

How fast a game moves through the ages, why each economy tech costs what it does, and how to
check both again after a change.

## Pacing targets

| Age | Target | Band the bench accepts |
|---|---|---|
| Town Age | about 10:00 | 8:00–12:00 |
| City Age | about 20:00 | 18:00–22:00 |
| Empire Age | about 30:00–35:00 | 28:00–37:00 |

Every economy tech has to **pay for itself within 5 sim-minutes** of clicking it, research time
included, with a typical crew of 6–10 villagers on that resource. Bronze Axe should take about
3 minutes with 8 woodcutters.

## The scripted build order

`src/bench/pacing.ts` plays player 1 on a real generated map (`generateMap(seed, 2)`, the real
`World`, no AI). It plays like a steady human player, not an optimised rush:

- It trains villagers without stopping, up to 70. The Town Center stops only while it researches.
- It builds houses ahead of population (up to 200), drop sites next to the nearest berries, trees,
  gold and stone (and moves on as they run out), then farms once the berries are gone. Fallow farms
  get reseeded.
- It splits villagers by the age it is working toward. The Village Age is 55% food and 45% wood.
  Later ages bring in gold and stone. When a resource runs out within reach, its share goes to the
  other resources.
- **It keeps a standing army.** From the Town Age it has one barracks per age past Village, each
  training hoplites without stopping, up to 125 soldiers. This stands in for a real player's
  military spending, so age-ups compete with it for food and wood. Without it, a 70-villager
  economy piles up resources and the costs can't produce a real game's arc.
- It researches economy techs when they're worth it: Bronze Axe at 5 woodcutters, Ox Plough at
  3 farms, and so on. Bronze Axe, Ox Plough, Donkey Packs, Bronze Picks, Iron Axe and Iron
  Ploughshare come before the next age-up. The rest wait until that age-up is paid for.
- It ages up as soon as it has the buildings and can pay. For the Town Age it builds a storehouse
  and a granary, for the City Age a forge and a market, and for the Empire Age an academy. If gold is
  the only thing missing, it sells spare wood or food at the market.
- It knows the map (its fog is explored at the start), so building placement never waits on scouting.

## Formulas

**Payback.** `crewRate` sets a crew to work on the same map, with the drop site next to the
resource, and measures net income over 300 s after a 30 s warm-up. It runs once without the tech
and once with it, and both arms already have the earlier techs in the chain. Payback is then

```
gain     = rate_with − rate_without            (resources / s)
payback  = research_time + total_cost / gain   (s)
```

- `total_cost` adds up every resource at face value.
- Nodes are topped up so neither arm runs dry, which means the difference comes from the tech alone.
- Farms never empty during the measurement. Instead each food a farm gives costs its reseed:
  `net food = food × (1 − farm_wood / food_per_field)`. That's how the farm techs' "+N food per
  field" counts.
- Carry and speed techs (Donkey Packs, Ox Carts) are measured on a mixed crew, because they help
  every villager.

**Age cost scale.** Villagers here gather about 0.7–0.8 resources/s and train in 8 s, so incomes
are roughly 4× an AoE2 game's. That puts the scripted economy at about 900/min at 10 min,
2,300/min at 15 min and 3,000/min at 25 min. Each age costs a few minutes of that income on top
of the army upkeep:

- Town Age: 400 food (about half a minute of Village income)
- City Age: 3,800 food and 800 gold (about 2 min of Town income)
- Empire Age: 12,000 food, 1,500 gold and 1,000 stone, with a 4-minute research (about 5 min of City income)

**Gold is the scarce resource.** Each start kit has 800 gold, and about 3,200 lies within 90 tiles
of a Town Center. The scripted player has mined all of that by about minute 22. Age gold costs stay
inside that budget, and the Empire Age leans on food. Anything past it has to come from the market
or trade carts.

## Results

`npm run bench:pacing` on lane/balance8 (M8 sim, 70 villagers, standing army).

### Age times, seeds 1–5

| Seed | Town | City | Empire |
|---|---|---|---|
| 1 | 10:39 | 19:03 | 31:10 |
| 2 | 10:35 | 19:09 | 31:34 |
| 3 | 10:39 | 19:19 | 32:09 |
| 4 | 10:45 | 19:20 | 32:14 |
| 5 | 10:45 | 19:13 | 32:00 |

With the old numbers (`townAge` 500f/60 s, `cityAge` 800f 200g/90 s, `empireAge` 1000f 800g
200s/120 s), the same build order reached Town at about 10:40, City at about 15:40 and Empire at
about 18:20. The pre-M8-17 code couldn't reach the Empire Age at all; see "Sim fix" below.

### Gather rate over time (seed 1, resources deposited per minute)

| Minute | Age | Villagers + soldiers | Workers f/w/g/s | Food | Wood | Gold | Stone |
|---|---|---|---|---|---|---|---|
| 5 | Village | 12 + 0 | 7/5/0/0 | 155 | 190 | 0 | 0 |
| 10 | Village | 32 + 0 | 14/12/5/1 | 656 | 218 | 13 | 0 |
| 15 | Town | 65 + 18 | 27/20/11/2 | 1263 | 687 | 283 | 104 |
| 20 | City | 70 + 44 | 27/19/18/5 | 1241 | 511 | 247 | 220 |
| 25 | City | 70 + 87 | 38/25/0/7 | 1667 | 1076 | 0 | 273 |
| 30 | City | 70 + 99 | 36/25/0/5 | 1753 | 548 | 0 | 78 |
| 35 | Empire | 70 + 99 | 41/27/0/0 | 2351 | 780 | 0 | 0 |

Gold stops at about minute 22 because nothing is left within reach. Wood per villager is low late
in the game because the woodline has moved far out. `--verbose` prints every minute for every seed.

### Economy tech payback (seed 1; seeds 2–5 match within a few seconds)

| Tech | Cost | Time | Crew | Gain | Payback (before → after) |
|---|---|---|---|---|---|
| Bronze Axe | 90f 50w | 25 s | 8 wood | +12.2% | 3:12 → **3:01** |
| Iron Axe | 125f 50g | 45 s | 10 wood | +11.1% | 5:23 → **3:24** |
| Two-Man Saw | 150f 75g | 60 s | 10 wood | +11.5% | 15:57 → **3:58** |
| Bronze Picks | 75f 75w | 30 s | 8 gold | +12.1% | 4:09 → **3:38** |
| Stone Chisels | 75f 75w | 30 s | 6 stone | +19.2% | 3:25 → **3:00** |
| Deep Shafts | 150f 100w | 45 s | 8 gold + 4 stone | +10.8% | 5:13 → **3:53** |
| Ore Sledges | 150f 100w | 50 s | 10 gold + 4 stone | +9.7% | 8:22 → **3:31** |
| Ox Plough | 75f 75w | 25 s | 8 farm | +18.6% | 4:49 → **3:43** |
| Iron Ploughshare | 125f 75w | 45 s | 10 farm | +18.4% | 9:09 → **3:55** |
| Crop Rotation | 150f 100w | 50 s | 10 farm | +18.6% | 15:01 → **4:09** |
| Threshing Floor | 100f 50w | 40 s | 6 berry | +14.0% | 5:53 → **3:48** |
| Donkey Packs | 175f 50w | 50 s | 8 wood + 8 farm + 4 gold | +7.6% | 4:32 → **4:07** |
| Ox Carts | 300f 200w | 75 s | 10 wood + 10 farm + 8 gold | +21.0% | 3:02 → 3:02 |

Village Age techs are judged with 8 workers. Town and City Age techs are judged with 10, because
camps are bigger by then. Census (villagers train 10% faster) isn't in the table because it doesn't
change gather rates. Its value is villagers arriving sooner, and that only matters while the Town
Center is still training.

### What changed in `src/core/techs.ts`

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
