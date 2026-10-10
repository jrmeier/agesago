# AI status (M7-2 economy, M8-16 research and ages)

The computer player (`AIPlayer`) acts only through `world.dispatch(cmd, player)`. It reads its
own units, buildings and stock, enemy units it can see right now, enemy buildings it has seen,
and resource nodes on ground it has explored. Only `hardest` ignores fog (and gets a small
resource trickle).

## Done

- Trains villagers from the Town Center up to the profile's target (36 at moderate).
- Splits gatherers across food, wood, gold and stone by target ratios that change over the game.
- Builds houses before the pop cap stalls villager production.
- Builds drop sites (storehouse, granary, mining camp) next to gatherers working far from one.
- Builds farms after the berries near the base are gone, and reseeds fallow farms.
- Sends the scout to unexplored ground, then patrols.
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
  while it saves for or researches an age. It stops at the City Age (no Empire step yet).
- **Priority table.** `RULES` lists each tech with a group (eco, tc, forge, line, defence), a
  base priority and a condition. Drop-site chains start once `ecoWorkers` (6 at moderate)
  villagers work that resource. TC techs: wovenTunics at 12 villagers or when raided, donkeyPacks
  at 20, census and townWatch in the Town Age, oxCarts in the City Age. Forge lines follow the
  army's class make-up (3+ units and a quarter of the army). Unit lines start at `lineUnits` of
  that kind. guardTower needs towers; masonry and ballistics need a ranged army. The profile
  weights each group (0 skips it).
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
- Player 1 has a big edge on these maps: two control AIs split 4–1 for player 1. As player 2 the
  researcher wins about half its games, against roughly 1 in 5 for the control.
- With the new City cost, no researcher reaches the City Age while fighting. Its edge comes from
  the Town Age: archers and swordsmen paid in gold, towers paid in stone, the forge, economy
  techs, and holding waves while it ages.
- Against an idle human, the researcher's army power (`armyPower`) is far below the control's
  until about minute 25, because it banks 3,800 food. It is ahead by minute 30 in 4 of 5 seeds.

## Open

- No Empire Age step, and no Empire-only techs.
- No market techs (coinage, caravans) and no trade carts.
- No walls, fortified walls or machicolations.
- Wonders and relics are out of scope.
