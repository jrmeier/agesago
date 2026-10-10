import { GRASS_ONLY, type Heightfield, type MapLayout, type NodeKind, type Vec2 } from '../core/types';
import { MAP_SIZES, type MapOptions, normalizeMapOptions } from '../core/maps';
import { createSeededRandom } from './terrain';

/** Symmetric economy pads and clear approaches on five distinct landscapes. */
export function generateVariantMap(seed: number, players: number, options: MapOptions): { hf: Heightfield; layout: MapLayout } {
  const { size, type } = normalizeMapOptions(options);
  const width = MAP_SIZES[size];
  const random = createSeededRandom(seed ^ 0x43a1847);
  const radius = width / 2 - 28;
  const centers = Array.from({ length: players }, (_, i) => {
    const angle = Math.PI + i * Math.PI * 2 / players;
    return players === 1 ? { x: width / 2, z: width / 2 } : { x: width / 2 + Math.cos(angle) * radius, z: width / 2 + Math.sin(angle) * radius };
  });
  const nearPad = (x: number, z: number) => Math.min(...centers.map(p => Math.hypot(x-p.x,z-p.z)));
  const wave = (x: number, z: number) => Math.sin(x * .08 + seed) * Math.cos(z * .07 - seed);
  const routeDistance = (x:number,z:number) => Math.min(...centers.map(c=> {
    const dx=c.x-width/2,dz=c.z-width/2,l2=dx*dx+dz*dz;
    const t=l2?Math.max(0,Math.min(1,((x-width/2)*dx+(z-width/2)*dz)/l2)):0;
    return Math.hypot(x-width/2-t*dx,z-width/2-t*dz);
  }));
  const heightAt = (x: number, z: number): number => {
    const pad = nearPad(x,z);
    if (pad < 25) return 1;
    let h = 1 + .35 * wave(x,z);
    if (type === 'highlands') h += 3 * (1 + wave(x,z));
    if (type === 'riverValley') {
      const d = Math.abs(x-width/2 - Math.sin(z / width * Math.PI * 2) * 6);
      const ford = Math.abs(z-width/2) < 6 || Math.abs(z-width*.25) < 5 || Math.abs(z-width*.75) < 5;
      if (d < 4 && !ford) h = -.8 + d*.15;
    }
    if (type === 'islands') {
      // Land bridges are deliberately wide enough for armies, preserving conquest
      // before transports. Broad sea quadrants support naval trade and fishing.
      // Bridges end at the towns, leaving an uninterrupted outer sea route.
      if (Math.hypot(x-width/2,z-width/2)>24 && routeDistance(x,z)>6) h = -1;
    }
    if (type === 'mediterranean') {
      const edge = Math.min(x,z,width-x,width-z);
      if (edge < 9) h = -.8 + edge*.13;
    }
    // Fade terrain back to level pads, including uninterrupted 24m economy kits.
    return pad < 29 ? 1 + (h-1)*(pad-25)/4 : h;
  };
  const forestDensity = (x:number,z:number) => nearPad(x,z)<25 || heightAt(x,z)<0 ? 0 : type==='forest' ? .85 : .55 + .3*wave(x,z);
  const hf: Heightfield = {
    width, depth:width, heightAt, forestDensity,
    isWater: (x,z) => x>=0 && z>=0 && x<=width && z<=width && heightAt(x,z)<0,
    isWalkable: (x,z) => x>=0 && z>=0 && x<=width && z<=width && heightAt(x,z)>=0,
    ground(x,z) {
      const h=heightAt(x,z), f=forestDensity(x,z);
      return h<.5 ? { ...GRASS_ONLY, grass:0, sand:1 } : type==='highlands' && h>4 ? { ...GRASS_ONLY,grass:.3,rock:.7 } : { ...GRASS_ONLY,grass:1-f*.5,forest:f*.5 };
    },
  };
  const starts = centers.map(townCenter => ({ townCenter, villagers:[{x:townCenter.x-1.8,z:townCenter.z+3.6},{x:townCenter.x,z:townCenter.z+3.8},{x:townCenter.x+1.8,z:townCenter.z+3.6}], scouts:[{x:townCenter.x-4.2,z:townCenter.z+1.2}] }));
  const layout: MapLayout = { ...starts[0], extraStarts:starts.slice(1), nodes:[], props:[], animals:[] };
  const add=(kind:NodeKind,pos:Vec2,amount:number) => layout.nodes.push({kind,pos,amount});
  for (const c of centers) {
    for (const x of [-17,-15.5,-14,-12.5]) for (const z of [-5.5,-4,-2.5,-1,.5]) add('tree',{x:c.x+x,z:c.z+z},100);
    add('berry',{x:c.x-6.5,z:c.z+14},125);
    for(let i=0;i<6;i++) add('berry',{x:c.x-6.5+Math.cos(i*Math.PI/3)*1.7,z:c.z+14+Math.sin(i*Math.PI/3)*1.7},125);
    for(const [x,z] of [[14,-5],[9,-13]]) add('gold',{x:c.x+x,z:c.z+z},400);
    for(const [x,z] of [[14,6],[5,-14]]) add('stone',{x:c.x+x,z:c.z+z},350);
    layout.animals!.push({kind:'sheep',pos:{x:c.x+4,z:c.z+8}},{kind:'sheep',pos:{x:c.x+6,z:c.z+8}});
  }
  // Grid spacing bounds work and guarantees resource collision spacing. Reserve
  // radial routes to the centre and the full economic pad of every player.
  for(let z=3;z<width-3;z+=1.8) for(let x=3;x<width-3;x+=1.8) {
    if(nearPad(x,z)<26 || !hf.isWalkable(x,z)) continue;
    const route=centers.some(c=> {
      const dx=c.x-width/2,dz=c.z-width/2,len=Math.hypot(dx,dz);
      return len>0 && Math.abs((x-width/2)*dz-(z-width/2)*dx)/len<3;
    });
    if(route) continue;
    const f=forestDensity(x,z), n=random();
    if(n < (type==='forest'?.62:.32)*f) add('tree',{x,z},100);
    else if(n>.995) add('gold',{x,z},400);
    else if(n>.989) add('stone',{x,z},350);
    else if(n>.98) add('berry',{x,z},125);
    else if(n>.96) layout.props.push({kind:type==='highlands'?'rocks':'bush',pos:{x,z},rot:random()*Math.PI*2,scale:.7,blockRadius:0});
  }
  // Shore fish are available to villagers and future boats on every wet map.
  for(let z=4;z<width-4;z+=4) for(let x=4;x<width-4;x+=4) if(heightAt(x,z)<0 && [hf.isWalkable(x+2,z),hf.isWalkable(x-2,z),hf.isWalkable(x,z+2),hf.isWalkable(x,z-2)].some(Boolean)) add('fish',{x,z},200);
  for(let z=12;z<width-12;z+=24) for(let x=12;x<width-12;x+=24) {
    if([[x,z],[x-2,z],[x+2,z],[x,z-2],[x,z+2]].every(([sx,sz])=>hf.isWater(sx,sz))) add('fish',{x,z},600);
  }
  return { hf,layout };
}
