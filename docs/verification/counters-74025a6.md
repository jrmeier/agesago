# Counter bench, source 74025a6

Command: `npm run bench:counters -- --matrix` (src/bench/counters.ts; Linux / Node 24.15, 2026-11-12). Deterministic.

## Counters (equal cost, City Age, no research, 3 line-ups × both sides)

| Counter | Beats | ≈ 1200: units, value left (counter / victim) | ≈ 3600: units, value left (counter / victim) |
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

## Matrix ≈ 1200: row unit's share of the value left against the column unit

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

## Matrix ≈ 3600: row unit's share of the value left against the column unit

| | Hoplite | Swordsman | Slinger | Archer | Scout | Horseman | Catapult | Bolt Shooter | Praetorian | Equites |
|---|---|---|---|---|---|---|---|---|---|---|
| Hoplite (80) | — | 0% | 0% | 14% | 100% | 100% | 100% | 100% | 0% | 100% |
| Swordsman (80) | 100% | — | 10% | 100% | 100% | 100% | 100% | 100% | 0% | 100% |
| Slinger (60) | 100% | 91% | — | 0% | 0% | 0% | 0% | 5% | 100% | 0% |
| Archer (70) | 89% | 0% | 100% | — | 0% | 0% | 0% | 0% | 0% | 0% |
| Scout (80) | 0% | 0% | 100% | 100% | — | 0% | 100% | 100% | 0% | 0% |
| Horseman (150) | 0% | 0% | 100% | 100% | 100% | — | 100% | 100% | 0% | 0% |
| Catapult (500) | 0% | 0% | 100% | 100% | 0% | 0% | — | 100% | 0% | 0% |
| Bolt Shooter (400) | 0% | 0% | 96% | 100% | 0% | 0% | 0% | — | 0% | 0% |
| Praetorian (240) | 100% | 100% | 0% | 100% | 100% | 100% | 100% | 100% | — | 100% |
| Equites (300) | 0% | 0% | 100% | 100% | 100% | 100% | 100% | 100% | 0% | — |

## Razing (≈ 900 resources, no garrison, no research)

| Attacker | Units | Target | Time | Value lost |
|---|---|---|---|---|
| Battering Ram | 2 | watchTower | 24 s | 2% |
| Catapult | 2 | watchTower | 54 s | 0% |
| Swordsman | 11 | watchTower | 109 s | 30% |
| Horseman | 6 | watchTower | 225 s | 75% |
| Archer | 13 | watchTower | 144 s | 0% |
| Battering Ram | 2 | stoneWall | 28 s | 0% |
| Catapult | 2 | stoneWall | 67 s | 0% |
| Swordsman | 11 | stoneWall | 93 s | 0% |
| Horseman | 6 | stoneWall | 217 s | 0% |
| Archer | 13 | stoneWall | 136 s | 0% |
| Battering Ram | 2 | townCenter | 54 s | 0% |
| Catapult | 2 | townCenter | 150 s | 0% |
| Swordsman | 11 | townCenter | 222 s | 0% |
| Horseman | 6 | townCenter | > 400 s | 0% |
| Archer | 13 | townCenter | 371 s | 0% |
| Battering Ram | 2 | fortress | 109 s | 31% |
| Catapult | 2 | fortress | 327 s | 0% |
| Swordsman | 11 | fortress | > 400 s | 100% |
| Horseman | 6 | fortress | > 400 s | 100% |
| Archer | 13 | fortress | > 400 s | 0% |
