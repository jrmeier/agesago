/**
 * Pacing benchmark (M8-17). See docs/BALANCE.md for what the numbers mean.
 *
 *   npm run bench:pacing                      # seeds 1–5 + payback table
 *   npm run bench:pacing -- --seeds 3 --verbose   # per-minute workers, gather rates, stock
 *   npm run bench:pacing -- --skip bronzeAxe  # counterfactual: never research these
 *   npm run bench:pacing -- --no-pacing --techs oxPlough,ironPloughshare --payback-seed 2
 *   --minutes N caps each run (default 40); --no-payback skips the payback table.
 */
import { TECHS, type TechId } from '../src/core/techs';
import { AGE_TARGETS, ECO_TECHS, PAYBACK_LIMIT, clock, measurePaybacks, runPacing } from '../src/bench/pacing';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const seeds = (opt('--seeds') ?? '1,2,3,4,5').split(',').map(Number);
const minutes = Number(opt('--minutes') ?? 40);
/** Counterfactual: the build order never researches these. */
const skip = (opt('--skip')?.split(',') ?? []) as TechId[];

if (!flag('--no-pacing')) {
  console.log(`\n## Age times (scripted build order, ${minutes} min cap)\n`);
  console.log('| Seed | Town | City | Empire | Villagers @10/20/30 min |');
  console.log('|---|---|---|---|---|');
  for (const seed of seeds) {
    const t0 = performance.now();
    const r = runPacing(seed, { maxSeconds: minutes * 60, skip });
    const vil = [10, 20, 30].map((m) => r.samples[m - 1]?.villagers ?? '—').join(' / ');
    const mark = (a: 1 | 2 | 3) => {
      const t = r.ages[a];
      const { lo, hi } = AGE_TARGETS[a];
      return `${clock(t)}${t !== null && t >= lo && t <= hi ? '' : ' ✗'}`;
    };
    console.log(`| ${seed} | ${mark(1)} | ${mark(2)} | ${mark(3)} | ${vil} |`);
    if (flag('--verbose')) {
      console.log(`\n  seed ${seed}: ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
      console.log('  techs: ' + Object.entries(r.techs).map(([t, s]) => `${t} ${clock(s!)}`).join(', '));
      console.log('  min | age | vills/cap | idle bld | workers f/w/g/s | gathered per min f/w/g/s | stock f/w/g/s');
      for (const s of r.samples) {
        const w = s.workers;
        const g = s.gathered;
        console.log(`  ${String(s.minute).padStart(3)} | ${s.age} | ${String(s.villagers).padStart(3)}+${s.soldiers}/${s.popCap} | ${s.idle} ${s.building} | ${w.food}/${w.wood}/${w.gold}/${w.stone} | ${g.food}/${g.wood}/${g.gold}/${g.stone} | ${s.stock.food}/${s.stock.wood}/${s.stock.gold}/${s.stock.stone}`);
      }
      console.log('');
    }
  }
  console.log(`\nTargets: Town ${clock(AGE_TARGETS[1].target)}, City ${clock(AGE_TARGETS[2].target)}, Empire ${clock(AGE_TARGETS[3].target)} (✗ = outside the band)`);
}

if (!flag('--no-payback')) {
  const seed = Number(opt('--payback-seed') ?? seeds[0]);
  console.log(`\n## Economy tech payback (seed ${seed}, limit ${PAYBACK_LIMIT} s incl. research)\n`);
  console.log('| Tech | Cost | Time | Crew | Rate before → after (/min) | Gain | Payback |');
  console.log('|---|---|---|---|---|---|---|');
  const only = opt('--techs')?.split(',');
  for (const p of measurePaybacks(seed, ECO_TECHS.filter((c) => !only || only.includes(c.tech)))) {
    const gain = ((p.with / p.without - 1) * 100).toFixed(1);
    const ok = p.payback <= PAYBACK_LIMIT ? '' : ' ✗';
    const cost = Object.entries(TECHS[p.tech].cost).map(([k, v]) => `${v}${k[0]}`).join(' ');
    console.log(`| ${TECHS[p.tech].name} | ${cost} | ${p.time}s | ${p.crew} | ${(p.without * 60).toFixed(0)} → ${(p.with * 60).toFixed(0)} | +${gain}% | ${clock(p.payback)}${ok} |`);
  }
}
