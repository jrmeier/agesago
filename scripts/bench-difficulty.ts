/**
 * M7-4: adjacent difficulty ladder, Hellenes mirrors, both seats, 40 min.
 * DIFFICULTY_BENCH_SEEDS changes the default sample of seeds 1–10.
 * Runs six shards by default; DIFFICULTY_BENCH_SHARDS changes concurrency. Set
 * DIFFICULTY_BENCH_SHARD to run one shard manually, then DIFFICULTY_BENCH_SUMMARY=1
 * to check the complete result. JSONL is resumable, keyed by source revision.
 * DIFFICULTY_BENCH_OUTPUT overrides the default /tmp/agesago-difficulty-<revision>.jsonl.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Difficulty, PlayerId } from '../src/core/types';
import { generateMap } from '../src/sim/mapgen';
import { World, defaultPlayers } from '../src/sim/World';
import { AIPlayer } from '../src/ai/AIPlayer';
import { census, run } from '../src/ai/harness';

const PAIRS: [Difficulty, Difficulty][] = [['easy', 'moderate'], ['moderate', 'hard'], ['hard', 'hardest']];
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const output = process.env.DIFFICULTY_BENCH_OUTPUT ?? `/tmp/agesago-difficulty-${revision}.jsonl`;
const seedCount = Number(process.env.DIFFICULTY_BENCH_SEEDS ?? 10);
if (!Number.isInteger(seedCount) || seedCount < 1) {
  throw new Error('DIFFICULTY_BENCH_SEEDS must be a positive integer.');
}
const shards = Number(process.env.DIFFICULTY_BENCH_SHARDS ?? 6);
const shard = process.env.DIFFICULTY_BENCH_SHARD === undefined ? null : Number(process.env.DIFFICULTY_BENCH_SHARD);
if (!Number.isInteger(shards) || shards < 1 || (shard !== null && (!Number.isInteger(shard) || shard < 0 || shard >= shards))) {
  throw new Error('Expected a positive shard count and a shard index in [0, shards).');
}
interface Row {
  id: string; revision: string; pair: string; seed: number; hiSeat: PlayerId;
  winner: number; hiWon: boolean; decided: boolean; reason: string | null;
  minutes: number; score: number[]; wallMs: number;
}
const read = (): Row[] => existsSync(output)
  ? readFileSync(output, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Row)
  : [];
const jobs = PAIRS.flatMap(([lo, hi]) => Array.from({ length: seedCount }, (_, i) => i + 1).flatMap(seed =>
  ([1, 2] as PlayerId[]).map(hiSeat => ({ lo, hi, seed, hiSeat, id: `${lo}<${hi}/${seed}/${hiSeat}` }))));
function rowsById(): Map<string, Row> {
  const rows = read();
  if (rows.some(row => row.revision !== revision)) throw new Error('Results are from another revision; choose a new DIFFICULTY_BENCH_OUTPUT.');
  return new Map(rows.map(row => [row.id, row]));
}

if (process.env.DIFFICULTY_BENCH_SUMMARY !== '1') {
  if (shard === null) {
    rowsById(); // Reject incompatible output before launching shards.
    const codes = await Promise.all(Array.from({ length: shards }, (_, index) => new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [
        fileURLToPath(new URL('../node_modules/vite-node/vite-node.mjs', import.meta.url)),
        fileURLToPath(import.meta.url),
      ], {
        env: { ...process.env, DIFFICULTY_BENCH_SHARD: String(index), DIFFICULTY_BENCH_OUTPUT: output },
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('exit', code => resolve(code ?? 1));
    })));
    if (codes.some(code => code !== 0)) process.exitCode = 1;
  } else {
    const done = rowsById();
    for (const [index, job] of jobs.entries()) {
      if (index % shards !== shard || done.has(job.id)) continue;
      const { lo, hi, seed, hiSeat, id } = job;
      const started = performance.now();
      const { hf, layout } = generateMap(seed, 2);
      const players = defaultPlayers(2, ['hellenes', 'hellenes']).map(p => ({
        ...p, control: 'ai' as const, difficulty: p.id === hiSeat ? hi : lo,
      }));
      const world = new World(hf, layout, players);
      world.seed = seed;
      // Measure military strength: only conquest or resignation decides before the cap.
      world.wonderRules.enabled = false;
      const ais = players.map(p => new AIPlayer(world, p.id, { difficulty: p.difficulty, seed: seed * 10 + p.id }));
      const over = () => world.gameOver !== null || world.defeatedPlayers.size > 0;
      for (let minute = 0; minute < 40 && !over(); minute++) {
        run(world, ais, 60, 0.05, over);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const score = [1, 2].map(p => {
        const c = census(world, p);
        return c.villagers + c.army + Object.values(c.buildings).reduce((a, b) => a + b, 0);
      });
      const loser = [...world.defeatedPlayers][0];
      const winner = world.gameOver?.winners[0] ?? (loser ? (loser === 1 ? 2 : 1)
        : score[0] === score[1] ? 0 : score[0] > score[1] ? 1 : 2);
      const row: Row = {
        id, revision, pair: `${lo}<${hi}`, seed, hiSeat, winner, hiWon: winner === hiSeat,
        decided: over(), reason: world.gameOver?.reason ?? null, minutes: +(world.time / 60).toFixed(1),
        score, wallMs: Math.round(performance.now() - started),
      };
      appendFileSync(output, JSON.stringify(row) + '\n');
      console.log(JSON.stringify(row));
      ais.forEach(ai => ai.dispose());
    }
  }
}

if (shard === null || process.env.DIFFICULTY_BENCH_SUMMARY === '1') {
  const rows = rowsById();
  const summary = PAIRS.map(([lo, hi]) => {
    const pair = `${lo}<${hi}`;
    const played = jobs.filter(job => `${job.lo}<${job.hi}` === pair).flatMap(job => rows.get(job.id) ?? []);
    const wins = played.filter(row => row.hiWon);
    return { pair, games: played.length, higherWon: wins.length, percent: 100 * wins.length / (2 * seedCount),
      seat1: wins.filter(row => row.hiSeat === 1).length, seat2: wins.filter(row => row.hiSeat === 2).length,
      decided: played.filter(row => row.decided).length, pass: played.length === 2 * seedCount && wins.length >= Math.ceil(1.6 * seedCount) };
  });
  console.table(summary);
  console.log(JSON.stringify({ output, revision, summary }));
  if (summary.some(row => !row.pass)) process.exitCode = 1;
}
