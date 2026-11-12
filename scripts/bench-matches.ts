/**
 * AI-vs-AI match length (M16-9). Moderate vs moderate on the default map (large Mediterranean,
 * `generateMap(seed, 2)`), played to conquest with a long cap, so the median is a real match
 * length rather than the civilization bench's 30-minute score cap. See docs/BALANCE.md.
 *
 *   npm run bench:matches                                   # seeds 1–10, both sides, 60 min cap
 *   MATCH_BENCH_SEEDS=1,2 MATCH_BENCH_MINUTES=75 npm run bench:matches
 *   MATCH_BENCH_SHARDS=6 MATCH_BENCH_SHARD=0 npm run bench:matches   # one of six parallel workers
 *   MATCH_BENCH_DIFFICULTY=hard npm run bench:matches               # default moderate
 *
 * Civilizations rotate through the six pairings by seed, so every civ appears. Rows are appended to
 * MATCH_BENCH_OUTPUT (default /tmp/agesago-match-length.jsonl); a rerun skips ids already there and
 * the summary at the end reads the whole file.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { CIV_IDS, type CivId } from '../src/core/civilizations';
import type { PlayerId } from '../src/core/types';
import { UNITS, isChampion, isHero } from '../src/core/units';
import { generateMap } from '../src/sim/mapgen';
import { World, defaultPlayers } from '../src/sim/World';
import { AIPlayer } from '../src/ai/AIPlayer';
import type { Difficulty } from '../src/ai/profile';
import { census, run } from '../src/ai/harness';

interface Row {
  id: string; seed: number; swap: boolean; civs: CivId[]; winner: number; resolution: 'conquest' | 'cap';
  minutes: number; ages: (number | null)[][]; peakArmy: number[]; heroes: number; champions: number; siege: number;
  wonders: number; fortresses: number; wallMs: number;
}

const output = process.env.MATCH_BENCH_OUTPUT ?? '/tmp/agesago-match-length.jsonl';
const cap = Number(process.env.MATCH_BENCH_MINUTES ?? 60);
const difficulty = (process.env.MATCH_BENCH_DIFFICULTY ?? 'moderate') as Difficulty;
const seeds = (process.env.MATCH_BENCH_SEEDS ?? '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const shards = Number(process.env.MATCH_BENCH_SHARDS ?? 1), shard = Number(process.env.MATCH_BENCH_SHARD ?? 0);
const read = (): Row[] => existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const done = new Set(read().map((r) => r.id));
const PAIRS: CivId[][] = [];
for (let a = 0; a < CIV_IDS.length; a++) for (let b = a + 1; b < CIV_IDS.length; b++) PAIRS.push([CIV_IDS[a], CIV_IDS[b]]);

let index = -1;
for (const seed of seeds) for (const swap of [false, true]) {
  index++;
  if (index % shards !== shard) continue;
  const id = `${seed}/${swap}`;
  if (done.has(id)) continue;
  const pair = PAIRS[(seed - 1) % PAIRS.length];
  const civs = swap ? [pair[1], pair[0]] : pair;
  const { hf, layout } = generateMap(seed, 2);
  const players = defaultPlayers(2, civs).map((p) => ({ ...p, control: 'ai' as const }));
  const world = new World(hf, layout, players);
  world.seed = seed;
  const ais = players.map((p) => new AIPlayer(world, p.id, { difficulty, seed: seed * 10 + p.id }));
  const started = performance.now();
  const peakArmy = [0, 0];
  const seen = { heroes: new Set<number>(), champions: new Set<number>(), siege: new Set<number>(), wonders: new Set<number>(), fortresses: new Set<number>() };
  const over = () => world.gameOver !== null || world.defeatedPlayers.size > 0;
  for (let minute = 0; minute < cap && !over(); minute++) {
    run(world, ais, 60, 0.05, over);
    for (const p of [1, 2] as PlayerId[]) peakArmy[p - 1] = Math.max(peakArmy[p - 1], census(world, p).army);
    for (const u of world.units.values()) {
      if (isHero(u.kind)) seen.heroes.add(u.id);
      else if (isChampion(u.kind)) seen.champions.add(u.id);
      else if (UNITS[u.kind].unitClass === 'siege') seen.siege.add(u.id);
    }
    for (const b of world.buildings.values()) {
      if (b.kind === 'wonder') seen.wonders.add(b.id);
      if (b.kind === 'fortress' && b.complete) seen.fortresses.add(b.id);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const loser = [...world.defeatedPlayers][0];
  const conquest = over();
  const s = [1, 2].map((p) => { const c = census(world, p); return c.villagers + c.army + Object.values(c.buildings).reduce((a, b) => a + b, 0); });
  const winner = world.gameOver?.winners[0] ?? (loser ? (loser === 1 ? 2 : 1) : s[0] === s[1] ? 0 : s[0] > s[1] ? 1 : 2);
  const row: Row = {
    id, seed, swap, civs, winner, resolution: conquest ? 'conquest' : 'cap', minutes: Math.round(world.time / 6) / 10,
    ages: ais.map((ai) => ai.research.agedAt.slice(1).map((t) => (t == null ? null : Math.round(t / 6) / 10))),
    peakArmy, heroes: seen.heroes.size, champions: seen.champions.size, siege: seen.siege.size, wonders: seen.wonders.size,
    fortresses: seen.fortresses.size, wallMs: Math.round(performance.now() - started),
  };
  appendFileSync(output, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
  ais.forEach((ai) => ai.dispose());
}

const rows = read();
const lengths = rows.map((r) => (r.resolution === 'conquest' ? r.minutes : Infinity)).sort((a, b) => a - b);
const median = lengths.length ? (lengths[(lengths.length - 1) >> 1] + lengths[lengths.length >> 1]) / 2 : NaN;
console.log(JSON.stringify({
  games: rows.length, conquests: rows.filter((r) => r.resolution === 'conquest').length, capMinutes: cap,
  medianMinutes: Number.isFinite(median) ? median : `>${cap}`, p1Wins: rows.filter((r) => r.winner === 1).length,
  sorted: lengths.map((l) => (Number.isFinite(l) ? l : `>${cap}`)),
}));
