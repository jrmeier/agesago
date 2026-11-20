/**
 * Cost-for-cost counter table (M16-9). See docs/BALANCE.md "Counters".
 *
 *   npm run bench:counters                 # the published table (src/core/counters.ts) + raze times
 *   npm run bench:counters -- --matrix     # every generic unit against every other
 *   npm run bench:counters -- --tiers      # generic line counters at tiers 0–3
 *   --budget N (default 1200 and 3600), --seeds N (default 3; --tiers defaults to 2)
 */
import { LINE_UNITS, MATRIX_UNITS, costOf, fight, raze } from '../src/bench/counters';
import { TECHS } from '../src/core/techs';
import { COUNTERS } from '../src/core/counters';
import { UNITS } from '../src/core/units';
import type { BuildingKind, UnitKind } from '../src/core/types';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const budgets = opt('--budget') ? [Number(opt('--budget'))] : [1200, 3600];
const tiers = args.includes('--tiers');
const seeds = Number(opt('--seeds') ?? (tiers ? 2 : 3));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const name = (k: UnitKind) => UNITS[k].name;

if (tiers) {
  console.log(`\n## Counter table by unit-line tier (${seeds} line-ups × both sides)\n`);
  console.log('Both sides have every generic line upgrade through the tier, no forge techs; City Age through tier 2, Empire Age at tier 3.');
  console.log("Share = counter's part of the value left; verdict uses the published 75% bar.\n");
  console.log('| tier | counter | victim | budget | units | share | counter left | victim left | verdict |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const tier of [0, 1, 2, 3] as const) {
    const title = (k: UnitKind) => Object.values(TECHS).find((t) => t.line?.unit === k && t.line.tier === tier)?.line?.title ?? name(k);
    for (const row of COUNTERS) for (const [a, b] of row.fights) {
      if (!LINE_UNITS.includes(a) || !LINE_UNITS.includes(b)) continue;
      for (const budget of budgets) {
        const r = fight(a, b, budget, { tier, seeds });
        const verdict = r.share >= 0.75 ? 'ok' : r.share > 0.5 ? 'wins <75%' : 'LOSES';
        console.log(`| ${tier} | ${title(a)} | ${title(b)} | ${budget} | ${r.na} v ${r.nb} | ${pct(r.share)} | ${pct(r.leftA)} | ${pct(r.leftB)} | ${verdict} |`);
      }
    }
  }
} else {
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
}
