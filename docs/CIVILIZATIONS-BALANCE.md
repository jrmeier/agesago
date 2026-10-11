# Civilization AI balance evidence

The full baseline tournament ran on 2026-10-10 against integrated simulation
`bf8af51`, with FIFO production and naval unit classes included. Every pairing
uses seeds 1–10, both starting sides, moderate AI, the legacy Large Mediterranean
map, and the live 50ms simulation step. All 120 unique results were checked against
the expected seed/side coverage.

Games stop at 30 simulated minutes. The winner is conquest when available, or
villagers + army + completed buildings at the cap; equal scores earn half a win
each. **All baseline games reached the score cap. These are score outcomes, not
measured conquest victory rates.**

## Baseline: failed two pairing bands

[Raw 120-game results](verification/civilizations-baseline-bf8af51.jsonl).

| Pairing | First civ wins | Draws | Games | First civ score win rate | 40–60% |
| --- | ---: | ---: | ---: | ---: | --- |
| Hellenes / Romans | 11 | 0 | 20 | 55% | Pass |
| Hellenes / Persians | 10 | 0 | 20 | 50% | Pass |
| Hellenes / Celts | 9 | 0 | 20 | 45% | Pass |
| Romans / Persians | 13 | 0 | 20 | 65% | Fail |
| Romans / Celts | 11 | 0 | 20 | 55% | Pass |
| Persians / Celts | 12 | 1 | 20 | 62.5% | Fail |

The threshold and draw handling are unchanged. Tuning `b181b17` increases Celts'
wood gathering bonus from 5% to 7%; `e943a06` reduces Romans' building HP bonus
from 5% to 3%. Both apply to the entire civilization. The rerun covers all five
pairings involving Romans or Celts (100 new games); Hellenes / Persians is
unchanged. The first rerun completed all 100 unique expected games.


## First tuning: one pairing still fails

[Raw 100-game rerun](verification/civilizations-tuning-e943a06.jsonl), source `e943a06`.
All games reached the score cap, with no draws. Five pairing workers ran from
17:20 to 17:34 America/Denver on 2026-10-10.

| Pairing | First civ wins | Games | First civ score win rate | 40–60% |
| --- | ---: | ---: | ---: | --- |
| Hellenes / Romans | 7 | 20 | 35% | Fail |
| Hellenes / Celts | 9 | 20 | 45% | Pass |
| Romans / Persians | 11 | 20 | 55% | Pass |
| Romans / Celts | 8 | 20 | 40% | Pass |
| Persians / Celts | 10 | 20 | 50% | Pass |

Hellenes / Persians retains its unchanged baseline 50%. The next global tuning
increases Hellenes' infantry training bonus from 5% to 7%. All three Hellenic
pairings will run again; Roman / Persian, Roman / Celt and Persian / Celt results
remain valid because their civilization data is unchanged. The second rerun completed all 60 unique expected games on GitHub runners.


## Second tuning: one Celtic pairing still fails

[Raw 60-game Hellenic rerun](verification/civilizations-hellenes-8af05a9.jsonl),
source `8af05a9`. [Temporary verification run](https://github.com/jrmeier/agesago/actions/runs/38096576652)
used three isolated Ubuntu / Node 20 jobs with no deployment. All 60 expected
seed/side IDs were verified, and all games reached the score cap with no draws.

| Pairing | First civ wins | Games | First civ score win rate | 40–60% |
| --- | ---: | ---: | ---: | --- |
| Hellenes / Romans | 9 | 20 | 45% | Pass |
| Hellenes / Persians | 12 | 20 | 60% | Pass |
| Hellenes / Celts | 7 | 20 | 35% | Fail |

The local attempt on the same source was stopped after nine completed games
because of host memory churn. Its [nine partial rows](verification/civilizations-local-partial-8af05a9.jsonl)
are separate from acceptance coverage. All nine overlapping IDs exactly match
the remote winners, scores, result labels and simulation time, despite the local
Node 26 / Apple Silicon runtime and remote Node 20 / Linux runtime.

Roman / Persian remains 55%, Roman / Celt 40%, and Persian / Celt 50% from the
first tuning. The next global adjustment reduces Celts' wood gathering bonus
from 7% to 6%; all three Celtic pairings will be rerun. Final acceptance remains
pending.
