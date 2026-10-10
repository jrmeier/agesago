import { MAP_SIZES,MAP_TYPES,type MapSize } from '../src/core/maps';
import { generateMap } from '../src/sim/mapgen';
let worst=0;
for(const size of Object.keys(MAP_SIZES) as MapSize[])for(const type of MAP_TYPES) {
 const started=performance.now();const {hf,layout}=generateMap(9,4,{size,type});const ms=performance.now()-started;worst=Math.max(worst,ms);
 console.log(JSON.stringify({size,type,width:hf.width,players:4,nodes:layout.nodes.length,ms,withinOneSecond:ms<1000}));
}
if(worst>=1000)process.exitCode=1;
