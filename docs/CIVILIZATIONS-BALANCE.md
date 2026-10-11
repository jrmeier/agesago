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

| Pairing | First civ wins | Draws | Games | First civ benchmark win rate | 40–60% |
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
97 games reached the score cap and three ended in conquest, with no draws.
Five pairing workers ran from 17:20 to 17:34 America/Denver on 2026-10-10.

| Pairing | First civ wins | Games | First civ benchmark win rate | 40–60% |
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

| Pairing | First civ wins | Games | First civ benchmark win rate | 40–60% |
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
first tuning. The next global adjustment reduced Celts' wood gathering bonus
from 7% to 6%; all three Celtic pairings were rerun. The final Celtic rerun
completed all 60 unique expected games.


## Final verified table: all six capped benchmark bands pass

[Raw final Celtic rerun](verification/civilizations-celts-a95d627.jsonl), source
`a95d627`, ran in [three isolated Node 20 jobs](https://github.com/jrmeier/agesago/actions/runs/38097537489).
The helper's simulation, AI and core source trees exactly match `a95d627`; its
workflow remains on a separate temporary branch and is excluded from product code.

[Assembled 120-game acceptance data](verification/civilizations-accepted-a95d627.jsonl)
and [machine-readable provenance](verification/civilizations-accepted-a95d627.metadata.json)
include the new Celtic pairings and unchanged non-Celtic pairings from earlier
runs. Their 120 IDs exactly cover all six pairings, seeds 1–10, and both starting
sides, with no duplicates. Score-cap winners were independently checked against
the recorded scores and civilization ordering.

| Pairing | First civ wins | Draws | Games | First civ benchmark win rate | 40–60% | Evidence source |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Hellenes / Romans | 9 | 0 | 20 | 45% | Pass | `8af05a9` |
| Hellenes / Persians | 12 | 0 | 20 | 60% | Pass | `8af05a9` |
| Hellenes / Celts | 10 | 0 | 20 | 50% | Pass | `a95d627` |
| Romans / Persians | 11 | 0 | 20 | 55% | Pass | `e943a06` |
| Romans / Celts | 10 | 0 | 20 | 50% | Pass | `a95d627` |
| Persians / Celts | 8 | 1 | 20 | 42.5% | Pass | `a95d627` |

Final starting bonuses are Hellenes infantry training 7% faster, Romans buildings
+3% HP, Persians food gathering 5% faster, and Celts wood gathering 6% faster.
Only Celts changed in the final adjustment, so non-Celtic pairings are unchanged.
The nine exact local/remote overlaps support retaining the prior macOS result
alongside the Linux results; all original per-round files are preserved above.

**The final 120 games contain 118 score-cap outcomes and two conquest outcomes.**
The table validates the specified band under this explicitly capped AI benchmark;
it does not establish a conquest-only win-rate band. No threshold was relaxed,
and the Persian / Celt draw contributes half a win. This final evidence update
changes documentation and data only; the tested source table stays at `a95d627`.
