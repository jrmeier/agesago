/**
 * Cost-for-cost counter table (M16-9). See docs/BALANCE.md "Counters".
 *
 *   npm run bench:counters                 # the published table (src/core/counters.ts) + raze times
 *   npm run bench:counters -- --matrix     # every generic unit against every other
 *   --budget N (default 1200 and 3600), --seeds N (default 3)
 */
import { MATRIX_UNITS, costOf, fight, raze } from '../src/bench/counters';
import { COUNTERS } from '../src/core/counters';
import { UNITS } from '../src/core/units';
import type { BuildingKind, UnitKind } from '../src/core/types';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const budgets = opt('--budget') ? [Number(opt('--budget'))] : [1200, 3600];
const seeds = Number(opt('--seeds') ?? 3);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const name = (k: UnitKind) => UNITS[k].name;

console.log(`\n## Counters (equal cost, City Age, no research, ${seeds} line-ups × both sides)\n`);
console.log(`| Counter | Beats | ${budgets.map((b) => `≈ ${b}: units, value left (counter / victim)`).join(' | ')} |`);
console.log(`|---|---|${budgets.map(() => '---').join('|')}|`);
for (const row of COUNTERS) for (const [a, b] of row.fights) {
  const cells = budgets.map((budget) => {
    const r = fight(a, b, budget, { seeds });
    return `${r.na} v ${r.nb}: ${pct(r.leftA)} / ${pct(r.leftB)}${r.share > 0.5 ? '' : ' ✗'}`;
  });
  console.log(`| ${name(a)} | ${name(b)} | ${cells.join(' | ')} |`);
}

if (args.includes('--matrix')) {
  for (const budget of budgets) {
    console.log(`\n## Matrix ≈ ${budget}: row unit's share of the value left against the column unit\n`);
    console.log(`| | ${MATRIX_UNITS.map(name).join(' | ')} |`);
    console.log(`|---|${MATRIX_UNITS.map(() => '---').join('|')}|`);
    for (const a of MATRIX_UNITS) {
      const cells = MATRIX_UNITS.map((b) => (a === b ? '—' : pct(fight(a, b, budget, { seeds }).share)));
      console.log(`| ${name(a)} (${costOf(a)}) | ${cells.join(' | ')} |`);
    }
  }
}

console.log(`\n## Razing (≈ 900 resources, no garrison, no research)\n`);
console.log('| Attacker | Units | Target | Time | Value lost |');
console.log('|---|---|---|---|---|');
for (const target of ['watchTower', 'stoneWall', 'townCenter', 'fortress'] as BuildingKind[]) {
  for (const k of ['ram', 'catapult', 'swordsman', 'horseman', 'archer'] as UnitKind[]) {
    const r = raze(k, target, 900, 400);
    console.log(`| ${name(k)} | ${r.n} | ${target} | ${r.seconds === null ? '> 400 s' : `${Math.round(r.seconds)} s`} | ${pct(r.lost)} |`);
  }
}
