import { describe, it, expect } from 'vitest';
import { MAP_SIZES, MAP_TYPES, type MapSize } from '../core/maps';
import { generateMap } from './mapgen';
import { World } from './World';
import { serializeWorld, deserializeWorld } from './serialize';

describe('map setup variants',()=> {
  it('rejects prototype keys as invalid map identities',()=>{expect(()=>generateMap(1,2,{size:'__proto__' as MapSize})).toThrow('Invalid map size');});
  it.each(Object.keys(MAP_SIZES).flatMap(size=>MAP_TYPES.map(type=>({size:size as MapSize,type}))))('$size $type generates balanced connected four-player starts in under one second', options=> {
    const t=performance.now(); const {hf,layout}=generateMap(9,4,options);
    expect(performance.now()-t).toBeLessThan(1000);
    expect(hf.width).toBe(MAP_SIZES[options.size]);
    const starts=[layout,...layout.extraStarts!];
    const totals=starts.map(({townCenter:c})=> {
      const nodes=layout.nodes.filter(n=>Math.hypot(n.pos.x-c.x,n.pos.z-c.z)<=24);
      return Object.fromEntries(['tree','berry','gold','stone'].map(kind=>[kind,nodes.filter(n=>n.kind===kind).reduce((s,n)=>s+n.amount,0)]));
    });
    expect(totals.every(t=>JSON.stringify(t)===JSON.stringify(totals[0]))).toBe(true);
    const world=new World(hf,layout);
    for(const start of starts) {
      expect(hf.isWalkable(start.townCenter.x,start.townCenter.z)).toBe(true);
      // Start just outside the TC, so a path check does not begin inside its footprint.
      expect(world.nav.findPath({x:starts[0].townCenter.x,z:starts[0].townCenter.z+6},{x:start.townCenter.x,z:start.townCenter.z+6})?.length ?? 0).toBeGreaterThan(0);
    }
  });
  it('island sea lanes remain connected around land bridges',()=>{
    const {hf}=generateMap(1,4,{size:'giant',type:'islands'});
    for(let i=2;i<hf.width-2;i+=2){expect(hf.isWater(i,2)).toBe(true);expect(hf.isWater(i,hf.depth-2)).toBe(true);expect(hf.isWater(2,i)).toBe(true);expect(hf.isWater(hf.width-2,i)).toBe(true);}
  });
  it('preserves non-default landscape and dimensions on load',()=> {
    const mapOptions={size:'small',type:'islands'} as const; const g=generateMap(7,2,mapOptions);
    const world=new World(g.hf,g.layout);world.seed=7;world.mapOptions=mapOptions;
    const save=serializeWorld(world); const loaded=deserializeWorld(save);
    expect(loaded.mapOptions).toEqual(mapOptions);expect(loaded.hf.width).toBe(120);
    expect(loaded.hf.heightAt(60,20)).toBe(world.hf.heightAt(60,20));
  });
});
