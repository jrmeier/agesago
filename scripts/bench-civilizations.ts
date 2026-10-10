/** Opt-in full AI tournament: ten seeds, swapped sides, all six pairings. */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { CIV_IDS, civFor, type CivId } from '../src/core/civilizations';
import { generateMap } from '../src/sim/mapgen';
import { World, defaultPlayers } from '../src/sim/World';
import { AIPlayer } from '../src/ai/AIPlayer';
import { census, run } from '../src/ai/harness';
const output=process.env.CIV_BENCH_OUTPUT ?? '/tmp/agesago-civ-tournament.jsonl';
const done=existsSync(output)?readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const score=(world:World,p:number)=>{const c=census(world,p);return c.villagers+c.army+Object.values(c.buildings).reduce((a,b)=>a+b,0)};
const filter=process.env.CIV_BENCH_CIV;
if(filter && !civFor(filter))throw new Error(`Unknown CIV_BENCH_CIV: ${filter}`);
let pairIndex=-1;
const shards=Number(process.env.CIV_BENCH_SHARDS ?? 1), shard=Number(process.env.CIV_BENCH_SHARD ?? 0);
for(let a=0;a<CIV_IDS.length;a++)for(let b=a+1;b<CIV_IDS.length;b++){
  if(filter && CIV_IDS[a]!==filter && CIV_IDS[b]!==filter)continue;
  pairIndex++;if(pairIndex%shards!==shard)continue;
  for(let seed=1;seed<=10;seed++)for(const swap of [false,true]) {
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
for(let a=0;a<CIV_IDS.length;a++)for(let b=a+1;b<CIV_IDS.length;b++) {
 if(filter && CIV_IDS[a]!==filter && CIV_IDS[b]!==filter)continue;
 const pair=[CIV_IDS[a],CIV_IDS[b]],games=completed.filter(r=>r.pair.join('/')===pair.join('/'));
 const rate=games.reduce((sum,r)=>sum+(r.winner===pair[0]?1:r.winner===null?.5:0),0)/games.length;
 console.log(JSON.stringify({pair,games:games.length,firstWinRate:rate,passes:games.length===20&&rate>=.4&&rate<=.6}));
}
