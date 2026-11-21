# Civilization AI balance evidence

## Current: M16-11 seat rotation after integration (2026-11-21)

Acceptance now uses **20 seeds per pairing**, each played from both sides: six pairings,
40 games each, 240 total. The default ten-seed quick run remains available. Moderate AI,
Large Mediterranean, the 30-minute cap and scoring (villagers + army + completed buildings)
are unchanged. Draws still contribute half a win to the first civilization's rate.

Fresh run on `5fb11b4`, rebased onto main `15a24c6`:
[240 game rows](verification/civilizations-accepted-5fb11b4.jsonl) and
[provenance](verification/civilizations-accepted-5fb11b4.metadata.json). Six reduced-priority
shards took 1,301.140 s wall time. All 240 unique IDs cover six pairings,
seeds 1–20 and both sides. This includes main's L60 slinger retune; M16-11 does not tune any numbers.

| Pairing | First civ wins | Draws | Games | First civ benchmark win rate | 40–60% |
|---|---|---|---|---|---|
| Hellenes / Romans | 17 | 0 | 40 | 42.5% | Pass |
| Hellenes / Persians | 20 | 0 | 40 | 50.0% | Pass |
| Hellenes / Celts | 18 | 0 | 40 | 45.0% | Pass |
| Romans / Persians | 21 | 1 | 40 | 53.8% | Pass |
| Romans / Celts | 20 | 1 | 40 | 51.3% | Pass |
| Persians / Celts | 16 | 0 | 40 | 40.0% | Pass |

All six pairing bands pass. 10 games ended in conquest and
230 at the score cap; these are capped benchmark rates, not
conquest-only win rates. Seat 2 won 115 of 238 decided games
(48.3%), compared with 85 of 118 (72.0%) in M13-7.

The [original pre-L60 240-game run](verification/civilizations-accepted-4741dcb.jsonl) and its
[provenance](verification/civilizations-accepted-4741dcb.metadata.json) remain historical evidence.
All its rows matched the prototype and all pairings passed; those results are superseded above.

The M13-7 fixed-seat bias note below is resolved by M16-11: seats rotate around the default
map's starts with the seed. The remaining geographic start advantage is an open follow-up
in [Seat fairness](BALANCE.md#seat-fairness-m16-11), separate from civilization balance.

**Romans / Celts was a sampling issue.** On pre-M16-11 main (`7157fcc`), seeds 1–10 reproduced 60.0%,
seeds 11–20 gave 42.5%, and all 40 games gave 51.3%. In the original pre-L60 seat-rotation run,
the first ten seeds gave 65.0%, while all 20 seeds gave 53.8%. Do not tune civilization numbers
from that 20-game subset; no civilization, unit or technology number changes in M16-11.

**Civilization technologies remain an AI follow-up.** In the diagnosis, moderate AI researched
Roman Engineering in only 15 of 964 Roman player-games; Hellenic Discipline, Royal Roads and
Woodland Craft each appeared in 0 of 20. The forge research rule requires five soldiers and
spare stock above the age-up reserve. Across eight probed player-games after Town Age, the
blockers were affordability (2,427 passes, including 1,802 holding an age reserve), no forge
(393), fewer than five soldiers (291), and a busy forge (49); no other tech outscored them.
Raising priority alone barely helped. A separate rule outside the forge group, bought once in
Town Age from the reserve, merits its own four-civilization balance rerun. This is outside the
seat fix: enabling four techs of differing strength together needs a separate balance pass.

Rerun on a fresh output path (do not reuse rows from another source revision):

```sh
for s in 0 1 2 3 4 5; do
  CIV_BENCH_SEEDS=20 CIV_BENCH_OUTPUT=/tmp/civ.jsonl CIV_BENCH_SHARDS=6 CIV_BENCH_SHARD=$s nice -n 10 npm run bench:civilizations &
done
wait
# Existing IDs are skipped; this prints the final six complete summaries.
CIV_BENCH_SEEDS=20 CIV_BENCH_OUTPUT=/tmp/civ.jsonl npm run bench:civilizations
```

## History: M13-7 rerun after the M13–M16 pacing changes (2026-11-12)

M13 (age gates, unit lines, pacing, AI), M16 (siege, champions, heroes,
late-game AI, counter table) and M16-10 (expansion gold, AI resignation)
changed the economy and armies this benchmark runs on. The tournament
therefore ran again with the same harness and rules as the history below:
`npm run bench:civilizations`, six pairings × seeds 1–10 × both sides,
moderate AI, legacy Large Mediterranean, a 30-minute score cap, villagers +
army + completed buildings, and draws worth half a win. All runs used six
pairing shards on one Linux x86_64 host with Node 24.15.0.

### Baseline on `3db2f1c`: one pairing fails

[Raw 120-game baseline](verification/civilizations-baseline-3db2f1c.jsonl).

| Pairing | First civ benchmark win rate | 40–60% |
| --- | ---: | --- |
| Hellenes / Romans | 40% | Pass |
| Hellenes / Persians | 52.5% | Pass |
| Hellenes / Celts | 32.5% | Fail |
| Romans / Persians | 45% | Pass |
| Romans / Celts | 60% | Pass |
| Persians / Celts | 55% | Pass |

An earlier full run on `551f803`, before M16-8/9/10 merged, failed only
Hellenes / Persians (62.5%). It is kept as
[superseded pre-rebase data](verification/civilizations-prerebase-551f803.jsonl)
and is not acceptance evidence.

### Tuning rounds

[All rejected candidate rows](verification/civilizations-tuning-3db2f1c.jsonl)
carry a `variant` field. Each round reran every pairing that involves a
changed civilization; the other pairings keep their baseline results.

| Candidate | H / R | H / P | H / C | R / P | R / C |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hellenes infantry train 9% faster | **30%** | 50% | 60% | — | — |
| + Roman Engineering +10% (from 15%) | **30%** | — | — | 45% | 60% |
| + Legionary melee 7 (from 8) | 60% | — | — | 55% | **35%** |
| + Legionary HP 60 (from 65) | 40% | — | — | 52.5% | **35%** |
| + Legionary HP 62 (from 65) | 60% | — | — | 42.5% | **35%** |
| **Hellenes infantry train 8% faster (accepted)** | 57.5% | 57.5% | 50% | — | — |

Roman Engineering changed no game at all, field for field, so that research
has no effect in this benchmark, and the change was reverted. Any Legionary
nerf large enough to move Hellenes / Romans also dropped Romans / Celts to 35%,
so the Legionary keeps its stats. The accepted change is Hellenes' infantry
training bonus from 7% to 8%. Romans, Persians and Celts are unchanged.

### Final verified table on `52a558a`: all six bands pass

[Raw 120-game acceptance run](verification/civilizations-accepted-52a558a.jsonl)
and [machine-readable provenance](verification/civilizations-accepted-52a558a.metadata.json).
This was a fresh full tournament on the committed source, 07:58–08:05 UTC.
Its 120 IDs exactly cover the six pairings, seeds 1–10 and both sides, with no
duplicates. The non-Hellenic rows reproduce the `3db2f1c` baseline, and the
Hellenic rows reproduce the 8% candidate round, with 0 mismatches in winner,
scores, resolution or simulation time.

| Pairing | First civ wins | Draws | Games | First civ benchmark win rate | 40–60% |
| --- | ---: | ---: | ---: | ---: | --- |
| Hellenes / Romans | 11 | 1 | 20 | 57.5% | Pass |
| Hellenes / Persians | 11 | 1 | 20 | 57.5% | Pass |
| Hellenes / Celts | 10 | 0 | 20 | 50% | Pass |
| Romans / Persians | 9 | 0 | 20 | 45% | Pass |
| Romans / Celts | 12 | 0 | 20 | 60% | Pass |
| Persians / Celts | 11 | 0 | 20 | 55% | Pass |

**113 games reached the score cap and 7 ended in conquest.** The capped
benchmark meaning is unchanged: these are not conquest-only win rates, and no
threshold was relaxed. Final starting bonuses are Hellenes infantry training 8%
faster, Romans buildings +3% HP, Persians food gathering 5% faster, and Celts
wood gathering 6% faster.

**Caveats.** With 20 games per pairing, one result has a binomial standard
deviation of about ±11 points, and most games end on small score margins.
Several pairings sit at the band edge (Romans / Celts 60%). Small, unrelated
changes reshuffle close games, so any later sim or AI change needs a fresh run
(M16-9's late-game pass is the next one). The second seat won 85 of 118
decisive games, against 33 for the first seat. The swapped-sides design cancels
this seat bias within each pairing, but it points to an asymmetry in the legacy
two-player map layout that deserves its own look.

## History (2026-10-10, superseded by the rerun above)


The full baseline tournament ran on 2026-10-10 against integrated simulation
`bf8af51`, with FIFO production and naval unit classes included. Every pairing
uses seeds 1–10, both starting sides, moderate AI, the legacy Large Mediterranean
map, and the live 50ms simulation step. All 120 unique results were checked against
the expected seed/side coverage.

Games stop at 30 simulated minutes. The winner is conquest when available, or
villagers + army + completed buildings at the cap; equal scores earn half a win
each. **All baseline games reached the score cap. These are score outcomes, not
measured conquest victory rates.**

### Baseline: failed two pairing bands

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


### First tuning: one pairing still fails

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


### Second tuning: one Celtic pairing still fails

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


### Final verified table: all six capped benchmark bands pass

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

### Applicability to the integrated product source

Product source `d2c5eee` has identical `src/core` and `src/ai` trees to `a95d627`,
but its `src/sim` tree differs. The exact tree match stated above applies to the
temporary verification helper, not to the entire integrated product. Reviewing
`git diff a95d627 d2c5eee -- src/sim` found four production changes and accompanying
tests:

- Exploration points and nearby clearance are added in `mapVariants.ts`.
  The benchmark calls `generateMap(seed, 2)` with default Large Mediterranean
  options, which bypasses this generator.
- Ship spawn positions gain water-cell checks and a corrected fallback.
  These branches require a ship kind; the benchmark AI trains land units only.
- Unit death clears naval, boarding and priest orders and ignores already
  removed units. Those order maps remain empty in this benchmark. Normal land
  combat resolves targets from the current unit map, stale spatial candidates
  are filtered, and building occupant deaths recheck that map. The duplicate
  cargo/resignation death path is unused: this AI has no ships, priests or
  resignation commands.
- Victory remains open for a match whose player roster has size one. The
  benchmark roster has two players throughout, including after defeat.

These reviewed changes do not alter the state transitions exercised by the
legacy two-player land benchmark, so its retained results apply to the integrated
source under those conditions. This is a scoped source applicability review,
not a claim that the simulation trees are identical or that the tournament was
rerun on `d2c5eee`.
