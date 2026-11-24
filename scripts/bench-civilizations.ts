/** AI tournament: default ten seeds is a quick look; acceptance uses CIV_BENCH_SEEDS=40
 * (480 games, 80 per pairing). Pairings must be 40–60%, pooled civilizations 45–55%.
 * CIV_BENCH_SUMMARY=1 checks existing rows without playing games. */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { CIV_IDS, civFor, type CivId } from '../src/core/civilizations';
import { generateMap } from '../src/sim/mapgen';
import { World, defaultPlayers } from '../src/sim/World';
import { AIPlayer } from '../src/ai/AIPlayer';
import { census, run } from '../src/ai/harness';
const output=process.env.CIV_BENCH_OUTPUT ?? '/tmp/agesago-civ-tournament.jsonl';
const done=existsSync(output)?readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const score=(world:World,p:number)=>{const c=census(world,p);return c.villagers+c.army+Object.values(c.buildings).reduce((a,b)=>a+b,0)};
const filters=(process.env.CIV_BENCH_CIV ?? '').split(',').filter(Boolean);
for(const filter of filters)if(!civFor(filter))throw new Error(`Unknown CIV_BENCH_CIV: ${filter}`);
let pairIndex=-1;
const shards=Number(process.env.CIV_BENCH_SHARDS ?? 1), shard=Number(process.env.CIV_BENCH_SHARD ?? 0);
/** Seeds per pairing, each played from both sides (M16-11: more seeds for a pairing near a band edge). */
const seedCount=Number(process.env.CIV_BENCH_SEEDS ?? 10);
if(!Number.isInteger(seedCount)||seedCount<1)throw new Error('CIV_BENCH_SEEDS must be a positive integer');
if(process.env.CIV_BENCH_SUMMARY!=='1') for(let a=0;a<CIV_IDS.length;a++)for(let b=a+1;b<CIV_IDS.length;b++){
  if(filters.length && !filters.includes(CIV_IDS[a]) && !filters.includes(CIV_IDS[b]))continue;
  pairIndex++;if(pairIndex%shards!==shard)continue;
  for(let seed=1;seed<=seedCount;seed++)for(const swap of [false,true]) {
  const pair=[CIV_IDS[a],CIV_IDS[b]],id=`${pair.join('/')}/${seed}/${swap}`;
  if(done.some(r=>r.id===id))continue;
  const civs=(swap?[pair[1],pair[0]]:pair) as CivId[];
  const {hf,layout}=generateMap(seed,2);
  const players=defaultPlayers(2,civs).map(p=>({...p,control:'ai' as const}));const world=new World(hf,layout,players);
  const ais=players.map(p=>new AIPlayer(world,p.id,{difficulty:'moderate',seed:seed*10+p.id}));
  const started=performance.now();let minute=0;
  for(;minute<30;minute++){run(world,ais,60,.05,()=>world.gameOver!==null);if(world.gameOver)break;await new Promise(resolve=>setTimeout(resolve,0));}
  const scores=[score(world,1),score(world,2)];
  const winner=world.gameOver?.winners[0]??(scores[0]===scores[1]?0:scores[0]>scores[1]?1:2);
  const row={id,pair,seed,swap,civs,winner:winner?civs[winner-1]:null,resolution:world.gameOver?'conquest':'score-cap',scores,simSeconds:world.time,wallMs:performance.now()-started};
  appendFileSync(output,JSON.stringify(row)+'\n');done.push(row);console.log(JSON.stringify(row));ais.forEach(ai=>ai.dispose());
}
}
const completed=existsSync(output)?readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
let passes = true;
for(let a=0;a<CIV_IDS.length;a++)for(let b=a+1;b<CIV_IDS.length;b++) {
 if(filters.length && !filters.includes(CIV_IDS[a]) && !filters.includes(CIV_IDS[b]))continue;
 const pair=[CIV_IDS[a],CIV_IDS[b]],games=completed.filter(r=>r.pair.join('/')===pair.join('/')&&r.seed<=seedCount);
 const rate=games.reduce((sum,r)=>sum+(r.winner===pair[0]?1:r.winner===null?.5:0),0)/games.length;
 const pass=games.length===seedCount*2&&rate>=.4&&rate<=.6;
 passes &&= pass;
 console.log(JSON.stringify({pair,games:games.length,firstWinRate:rate,passes:pass}));
}
for (const civ of CIV_IDS) {
  const games=completed.filter(r=>r.pair.includes(civ)&&r.seed<=seedCount);
  const rate=games.reduce((sum,r)=>sum+(r.winner===civ?1:r.winner===null?.5:0),0)/games.length;
  const complete=games.length===seedCount*6;
  const pass=complete&&rate>=.45&&rate<=.55;
  // A filtered quick look has not played the other pairings; report without judging it.
  if(!filters.length||complete) passes &&= pass;
  console.log(JSON.stringify({civ,games:games.length,pooledWinRate:rate,complete,passes:pass}));
}
if((shards===1||process.env.CIV_BENCH_SUMMARY==='1')&&!passes)process.exitCode=1;
