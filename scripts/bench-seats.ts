/**
 * Seat and start fairness (M16-11, T119): mirror matches, the same civilization in both seats,
 * moderate vs moderate on the default map (large Mediterranean, `generateMap(seed, 2)`), 30 minutes
 * then the civilization bench's score (villagers + soldiers + finished buildings). Of the decided
 * games, neither seat may win more than 60%; the east start must win 45–55% overall and 40–60% for
 * every civilization. See docs/BALANCE.md.
 *
 *   npm run bench:seats                                         # 4 civs × seeds 1–40 = 160 games
 *   SEAT_BENCH_SEEDS=1-80 SEAT_BENCH_CIVS=romans npm run bench:seats
 *   SEAT_BENCH_SHARDS=8 SEAT_BENCH_SHARD=0 npm run bench:seats   # one of eight parallel workers
 *   SEAT_BENCH_SUMMARY=1 npm run bench:seats                    # only summarise the output file
 *
 * Rows are appended to SEAT_BENCH_OUTPUT (default /tmp/agesago-seats.jsonl); a rerun skips ids
 * already there and the summary reads the whole file. Exit code 1 when a share is out of band.
 * One 40-game group has a standard error of 8 points: a fair map fails some band in about half
 * of all 160-game runs, so judge start fairness on seeds 1–160 (640 games).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { CIV_IDS, civFor, type CivId } from '../src/core/civilizations';
import { generateMap } from '../src/sim/mapgen';
import { World, defaultPlayers } from '../src/sim/World';
import { AIPlayer } from '../src/ai/AIPlayer';
import { census, run } from '../src/ai/harness';

interface Row {
  id: string; civ: CivId; seed: number;
  /** 1 or 2, or 0 for an equal score at the cap. */
  winner: number;
  /** Seat 1 started on the east side of the map. */
  seat1East: boolean;
  resolution: 'conquest' | 'score-cap'; scores: number[]; simSeconds: number; wallMs: number;
}

const output = process.env.SEAT_BENCH_OUTPUT ?? '/tmp/agesago-seats.jsonl';
const [first, last] = (process.env.SEAT_BENCH_SEEDS ?? '1-40').split('-').map(Number);
const civs = (process.env.SEAT_BENCH_CIVS ?? CIV_IDS.join(',')).split(',').filter(Boolean) as CivId[];
for (const civ of civs) if (!civFor(civ)) throw new Error(`Unknown SEAT_BENCH_CIVS entry: ${civ}`);
const shards = Number(process.env.SEAT_BENCH_SHARDS ?? 1), shard = Number(process.env.SEAT_BENCH_SHARD ?? 0);
const read = (): Row[] => existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = new Set(read().map((r) => r.id));
const score = (world: World, p: number) => { const c = census(world, p); return c.villagers + c.army + Object.values(c.buildings).reduce((a, b) => a + b, 0); };

let index = -1;
if (!process.env.SEAT_BENCH_SUMMARY) for (const civ of civs) for (let seed = first; seed <= last; seed++) {
  index++;
  const id = `${civ}/${seed}`;
  if (index % shards !== shard || done.has(id)) continue;
  const { hf, layout } = generateMap(seed, 2);
  const players = defaultPlayers(2, [civ, civ]).map((p) => ({ ...p, control: 'ai' as const }));
  const world = new World(hf, layout, players);
  const ais = players.map((p) => new AIPlayer(world, p.id, { difficulty: 'moderate', seed: seed * 10 + p.id }));
  const started = performance.now();
  for (let minute = 0; minute < 30 && !world.gameOver; minute++) {
    run(world, ais, 60, 0.05, () => world.gameOver !== null);
    await new Promise((r) => setTimeout(r, 0));
  }
  const scores = [score(world, 1), score(world, 2)];
  const row: Row = {
    id, civ, seed, winner: world.gameOver?.winners[0] ?? (scores[0] === scores[1] ? 0 : scores[0] > scores[1] ? 1 : 2),
    seat1East: layout.townCenter.x > hf.width / 2, resolution: world.gameOver ? 'conquest' : 'score-cap', scores,
    simSeconds: Math.round(world.time), wallMs: Math.round(performance.now() - started),
  };
  appendFileSync(output, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
  ais.forEach((ai) => ai.dispose());
}

const summary = (label: string, rows: Row[], eastBand: [number, number]) => {
  const decided = rows.filter((r) => r.winner !== 0);
  const seat2 = decided.filter((r) => r.winner === 2).length;
  const east = decided.filter((r) => (r.winner === 1) === r.seat1East).length;
  const share = decided.length ? seat2 / decided.length : NaN;
  const eastShare = decided.length ? east / decided.length : NaN;
  return {
    group: label, games: rows.length, decided: decided.length, seat1Wins: decided.length - seat2, seat2Wins: seat2,
    seat2Share: Math.round(share * 1000) / 1000, eastWins: east, eastStartShare: Math.round(eastShare * 1000) / 1000,
    seat1East: rows.filter((r) => r.seat1East).length,
    passes: share >= 0.4 && share <= 0.6 && eastShare >= eastBand[0] && eastShare <= eastBand[1],
  };
};
const rows = read();
const groups = civs.map((civ) => summary(civ, rows.filter((r) => r.civ === civ), [0.4, 0.6]));
groups.push(summary('all', rows.filter((r) => civs.includes(r.civ)), [0.45, 0.55]));
for (const group of groups) console.log(JSON.stringify(group));
// Shards only play their share; judge the whole file with SEAT_BENCH_SUMMARY=1 once they finish.
if ((shards === 1 || process.env.SEAT_BENCH_SUMMARY) && !groups.every((group) => group.passes)) process.exitCode = 1;
