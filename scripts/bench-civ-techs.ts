/**
 * T121: how often each AI difficulty researches its civilization's techs.
 *
 * Same-difficulty games on the default map, 30 sim minutes, every civilization in both seats:
 * four pairings x CIV_TECH_BENCH_SEEDS seeds (default 10) x both seats x difficulties (default
 * easy,moderate,hard) = 40 player-games per civilization and difficulty. One JSONL row per game,
 * resumable, keyed by source revision. Three shards by default (CIV_TECH_BENCH_SHARDS);
 * CIV_TECH_BENCH_SUMMARY=1 only checks a finished file.
 *
 * Pass (moderate and hard, every civilization): of the player-games that reached the Town Age,
 * at least 80% started the civilization's forge tech (CIVS[civ].tech). Easy never researches it
 * by design and is reported, not gated. T123 also gates median delays from Town Age: forge
 * complete <=120 s and civ tech started <=180 s, with missing milestones counted as infinity. The elite unit upgrade (City Age) is reported too: the AI
 * buys it only once it fields the unique unit, which it rarely does (a follow-up, not T121).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CIVS, CIV_IDS, type CivId } from '../src/core/civilizations';
import { TECHS, TECH_IDS, type TechId } from '../src/core/techs';
import type { Difficulty, PlayerId } from '../src/core/types';
import { generateMap } from '../src/sim/mapgen';
import { World, defaultPlayers } from '../src/sim/World';
import { AIPlayer } from '../src/ai/AIPlayer';
import { run } from '../src/ai/harness';

const PAIRS: [CivId, CivId][] = [['hellenes', 'romans'], ['persians', 'celts'], ['romans', 'persians'], ['celts', 'hellenes']];
const GATED: Difficulty[] = ['moderate', 'hard'];
const THRESHOLD = 0.8;
const MINUTES = 30;
/** Seconds between samples of why the forge tech has not started yet. */
const SAMPLE = 10;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const output = process.env.CIV_TECH_BENCH_OUTPUT ?? `/tmp/agesago-civ-techs-${revision}.jsonl`;
const shards = Number(process.env.CIV_TECH_BENCH_SHARDS ?? 3);
const shard = process.env.CIV_TECH_BENCH_SHARD === undefined ? null : Number(process.env.CIV_TECH_BENCH_SHARD);
const seeds = Number(process.env.CIV_TECH_BENCH_SEEDS ?? 10);
const difficulties = (process.env.CIV_TECH_BENCH_DIFFICULTIES ?? 'easy,moderate,hard').split(',') as Difficulty[];
if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(seeds) || seeds < 1) throw new Error('Bad shard or seed count.');

/** The elite upgrade of a civilization's unique unit. */
const eliteOf = (civ: CivId): TechId => TECH_IDS.find((t) => TECHS[t].civ === civ && TECHS[t].line?.unit === CIVS[civ].unit)!;

interface PlayerRow {
  civ: CivId;
  /** Sim second each age was reached (index = age). */
  agedAt: number[];
  /** Sim second the forge tech / elite upgrade was started, or null. */
  forgeTechAt: number | null;
  eliteAt: number | null;
  /** First forge foundation and completion, from sim events (not sampled). */
  forgePlacedAt: number | null;
  forgeAt: number | null;
  /** Unique units alive at the end. */
  uniqueUnits: number;
  /** Seconds in the Town Age or later without the forge tech, by what stood in the way. */
  waiting: { noForge: number; forgeBusy: number; poor: number; eligible: number };
  /** Non-age techs started. */
  techs: number;
}
interface Row { id: string; revision: string; difficulty: Difficulty; seed: number; swap: boolean; minutes: number; decided: boolean; players: PlayerRow[]; wallMs: number }

const jobs = difficulties.flatMap((difficulty) => PAIRS.flatMap((civs) =>
  Array.from({ length: seeds }, (_, i) => i + 1).flatMap((seed) => [false, true].map((swap) =>
    ({ difficulty, civs, seed, swap, id: `${difficulty}/${civs.join('-')}/${seed}/${swap}` })))));
const read = (): Row[] => existsSync(output) ? readFileSync(output, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row) : [];
function rowsById(): Map<string, Row> {
  const rows = read();
  if (rows.some((r) => r.revision !== revision)) throw new Error('Results are from another revision; choose a new CIV_TECH_BENCH_OUTPUT.');
  return new Map(rows.map((r) => [r.id, r]));
}

if (process.env.CIV_TECH_BENCH_SUMMARY !== '1') {
  if (shard === null) {
    rowsById();
    const codes = await Promise.all(Array.from({ length: shards }, (_, index) => new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [
        fileURLToPath(new URL('../node_modules/vite-node/vite-node.mjs', import.meta.url)),
        fileURLToPath(import.meta.url),
      ], { env: { ...process.env, CIV_TECH_BENCH_SHARD: String(index), CIV_TECH_BENCH_OUTPUT: output }, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    })));
    if (codes.some((c) => c !== 0)) process.exitCode = 1;
  } else {
    const done = rowsById();
    for (const [index, job] of jobs.entries()) {
      if (index % shards !== shard || done.has(job.id)) continue;
      const started = performance.now();
      const { hf, layout } = generateMap(job.seed, 2);
      // Every seed is played in both seats.
      const civs = job.swap ? [job.civs[1], job.civs[0]] : job.civs;
      const players = defaultPlayers(2, civs).map((p) => ({ ...p, control: 'ai' as const, difficulty: job.difficulty }));
      const world = new World(hf, layout, players);
      world.seed = job.seed;
      world.wonderRules.enabled = false;
      const ais = players.map((p) => new AIPlayer(world, p.id, { difficulty: job.difficulty, seed: job.seed * 10 + p.id }));
      const rows: PlayerRow[] = civs.map((civ) => ({
        civ, agedAt: [0], forgeTechAt: null, eliteAt: null, forgeAt: null, forgePlacedAt: null, uniqueUnits: 0,
        waiting: { noForge: 0, forgeBusy: 0, poor: 0, eligible: 0 }, techs: 0,
      }));
      const recordForge = (id: number, field: 'forgeAt' | 'forgePlacedAt') => {
        const b = world.buildings.get(id);
        if (b?.kind === 'forge' && rows[b.owner - 1]?.[field] === null) rows[b.owner - 1][field] = Math.round(world.time);
      };
      const offs = [
        world.events.on('spawned', (e) => recordForge(e.id, 'forgePlacedAt')),
        world.events.on('constructed', (e) => recordForge(e.id, 'forgeAt')),
      ];
      const over = () => world.gameOver !== null || world.defeatedPlayers.size > 0;
      for (let t = 0; t < MINUTES * 60 && !over(); t += SAMPLE) {
        run(world, ais, SAMPLE, 0.05, over);
        for (const p of players) {
          const row = rows[p.id - 1];
          const state = world.players.get(p.id)!;
          if (state.age < 1 || world.defeatedPlayers.has(p.id as PlayerId)) continue;
          const forges = [...world.buildings.values()].filter((b) => b.owner === p.id && b.kind === 'forge' && b.complete);
          const tech = CIVS[row.civ].tech;
          if (state.researched.has(tech) || forges.some((b) => b.research?.includes(tech))) continue;
          const stock = world.stockOf(p.id);
          const cost = TECHS[tech].cost;
          const why = !forges.length ? 'noForge'
            : forges.every((b) => b.research?.length || b.upgrading) ? 'forgeBusy'
            : (Object.keys(cost) as (keyof typeof cost)[]).some((k) => stock[k] < cost[k]!) ? 'poor' : 'eligible';
          row.waiting[why] += SAMPLE;
        }
        if (t % 60 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      for (const [i, ai] of ais.entries()) {
        const row = rows[i];
        row.agedAt = ai.research.agedAt.map((a) => Math.round(a));
        const at = (tech: TechId) => { const s = ai.research.started.find((x) => x.tech === tech); return s ? Math.round(s.at) : null; };
        row.forgeTechAt = at(CIVS[row.civ].tech);
        row.eliteAt = at(eliteOf(row.civ));
        row.techs = ai.research.started.filter((x) => TECHS[x.tech].ageUp === undefined).length;
        for (const u of world.units.values()) if (u.owner === ai.player && u.kind === CIVS[row.civ].unit) row.uniqueUnits++;
      }
      const row: Row = { id: job.id, revision, difficulty: job.difficulty, seed: job.seed, swap: job.swap, minutes: +(world.time / 60).toFixed(1), decided: over(), players: rows, wallMs: Math.round(performance.now() - started) };
      appendFileSync(output, JSON.stringify(row) + '\n');
      console.log(JSON.stringify(row));
      offs.forEach((off) => off());
      ais.forEach((ai) => ai.dispose());
    }
  }
}

if (shard === null || process.env.CIV_TECH_BENCH_SUMMARY === '1') {
  const rows = rowsById();
  const complete = jobs.every((j) => rows.has(j.id));
  const summary = difficulties.flatMap((difficulty) => CIV_IDS.map((civ) => {
    const ps = [...rows.values()].filter((r) => r.difficulty === difficulty).flatMap((r) => r.players.filter((p) => p.civ === civ));
    const town = ps.filter((p) => p.agedAt[1] !== undefined);
    const city = ps.filter((p) => p.agedAt[2] !== undefined);
    const forgeTech = town.filter((p) => p.forgeTechAt !== null).length;
    const elite = city.filter((p) => p.eliteAt !== null).length;
    const gated = GATED.includes(difficulty);
    const wait = (k: keyof PlayerRow['waiting']) => Math.round(town.reduce((a, p) => a + p.waiting[k], 0) / Math.max(1, town.length));
    // Missing milestones count as infinity: late/dead players cannot improve the median.
    const medianDelay = (key: 'forgeAt' | 'forgePlacedAt' | 'forgeTechAt') => {
      const delays = town.map((p) => p[key] === null ? Infinity : p[key]! - p.agedAt[1]).sort((a, b) => a - b);
      const mid = Math.floor(delays.length / 2);
      const value = delays.length ? (delays[mid] + delays[Math.floor((delays.length - 1) / 2)]) / 2 : Infinity;
      return Number.isFinite(value) ? value : null;
    };
    const forgePlacedDelay = medianDelay('forgePlacedAt');
    const forgeDelay = medianDelay('forgeAt');
    const civTechDelay = medianDelay('forgeTechAt');
    return {
      difficulty, civ, forgePlacedDelay, forgeDelay, civTechDelay, players: ps.length, town: town.length, forgeTech, city: city.length, elite,
      noForge: wait('noForge'), forgeBusy: wait('forgeBusy'), poor: wait('poor'), eligible: wait('eligible'),
      pass: !gated || (town.length > 0 && forgeTech >= THRESHOLD * town.length && forgeDelay !== null && forgeDelay <= 120 && civTechDelay !== null && civTechDelay <= 180),
    };
  }));
  console.table(summary);
  console.log(JSON.stringify({ output, revision, complete, summary }));
  if (!complete || summary.some((r) => !r.pass)) process.exitCode = 1;
}
