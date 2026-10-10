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
unchanged. Final rerun evidence is pending.
