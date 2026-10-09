# AI status (ticket #34, M7-2: AI economy)

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
- Military (barracks, waves, defence, retreat) is in `military.ts`. It is not part of this ticket's acceptance.

## Acceptance test

`src/ai/economy.test.ts` runs seeds 1–5 at moderate difficulty for 12 sim minutes each against
an idle human. It checks for each seed:

- at least 30 villagers
- no pop-cap stall longer than 10 s while the AI has 30 wood and an idle villager, and no stall at the end
- at least one completed drop site
- the scout moved more than 10 units
- no farm before the home berries are gone
- average AI planning time under 1 ms per sim tick

## Open

- **"Reaches the next age" is not done.** Ages belong to ticket M8-1, which doesn't exist yet.
  This lane does not add an age field. When the sim has ages, the economy needs an age-up step
  and the test needs a matching check.
- Wonders and relics are out of scope.
