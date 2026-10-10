# Civilizations and map setup

The setup screen selects Hellenes, Romans, Persians or Celts. Rivals cycle through
that roster from the chosen civilization; callers can instead supply `MatchStart.civs`
for an explicit deterministic roster. Old saves and matches without a civilization
retain the original unit roster and statistics.

`core/civilizations.ts` is the shared table for each starting bonus, unique soldier,
unique research and architecture palette. Bonuses use the technology modifier
resolver `(base + sums of additions) × products of multipliers`, including its
cached sim reads. Unique units are rejected by the sim for other civilizations;
HUD training slots, hotkeys, AI production and unique research use the same gates.
Models change the existing soldier silhouettes without additional draw calls;
architecture changes vertex colours in owned buffers, including upgraded buildings.

| Civilization | Starting bonus | Unique soldier | Unique research |
| --- | --- | --- | --- |
| Hellenes | Infantry train 5% faster | Phalangite Guard | Infantry +1 melee armour |
| Romans | Buildings +5% HP | Legionary | Buildings construct 15% faster |
| Persians | Villagers gather food 5% faster | Immortal | Villagers and trade carts walk 10% faster |
| Celts | Villagers gather wood 5% faster | Raider | Wood carry +3, infantry speed +5% |

Map sizes are Small 120, Medium 144, Large 176 and Giant 192 world units square.
Landscape choices are Mediterranean, Highlands, River Valley, Forest and Islands.
The default Large Mediterranean generator retains its original seeded layout.
Other landscapes reserve identical level 24m economy pads and clear routes from
all players to the centre. Islands contain wide land bridges and sea quadrants;
naval play supplements land conquest. Shore fish remain available; new wet variants
also reserve deep-water fishing nodes on a 24m grid with 600 food each.

Seed, map size, landscape and civilization roster persist in saves. Invalid map or
civilization identifiers are rejected on load rather than silently changing the map.

## Verification

The map tests cover all 20 size/landscape combinations with four-player starting
resource equality and actual navigation between starts. `npm run bench:maps` runs
those generations on a single process and reports the one-second budget explicitly.
Low-tier rendering tests check finite terrain, dimensions, a 305k triangle ceiling
and the inexpensive water material for all combinations. These structural checks
are not a physical-phone frame-rate measurement.

Browser checks on desktop and emulated Pixel 7 cover civilization/map selection,
match boot, save, resume, no overflow and no runtime errors. Existing title/menu
checks continue to pass. Civilization tests cover modifiers, research ownership,
unique training rosters, models, architecture buffer isolation and save/load.

`npm run bench:civilizations` runs the full six-pairing moderate-AI tournament with
ten seeds and swapped sides (20 games per pairing). It writes resumable JSON lines
to `/tmp/agesago-civ-tournament.jsonl`, or `CIV_BENCH_OUTPUT`. Each game runs up to
30 sim minutes. A conquest winner is used when present; remaining games are
explicitly labeled `score-cap` and scored by villagers + army + completed buildings,
matching the established AI comparison harness. The output includes each result
and checks the required 40–60% pairing range. Optional `CIV_BENCH_SHARDS` and
`CIV_BENCH_SHARD` select disjoint pairing groups for parallel runs; all groups
append to the same results file. Do not infer that this range has passed
from the existence of the benchmark script; record its actual completed results.
