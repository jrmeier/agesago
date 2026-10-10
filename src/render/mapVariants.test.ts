import { beforeAll,it,expect } from 'vitest';
import * as THREE from 'three';
import { MAP_TYPES,MAP_SIZES,type MapSize } from '../core/maps';
import { qualityTier } from '../core/quality';
import { generateMap } from '../sim/mapgen';
import { TerrainView } from './TerrainView';
beforeAll(()=>{
  const data=new Uint8ClampedArray(512*512*4);const ctx:object=new Proxy(function(){},{apply:()=>ctx,get:(_t,p)=>p==='data'?data:ctx});
  Object.assign(globalThis,{document:{createElement:()=>({width:0,height:0,getContext:()=>ctx})}});
});
it.each(Object.keys(MAP_SIZES).flatMap(size=>MAP_TYPES.map(type=>({size:size as MapSize,type}))))('low-tier terrain stays finite and within the giant terrain budget for $size $type',options=>{
  const g=generateMap(1,2,options); const view=new TerrainView(g.hf,qualityTier('low'));
  const ground=view.object.children[0] as THREE.Mesh;const positions=ground.geometry.getAttribute('position');
  expect(ground.geometry.index!.count/3).toBeLessThan(305000);
  for(let i=0;i<positions.count;i+=113){expect(Number.isFinite(positions.getY(i))).toBe(true);expect(positions.getX(i)).toBeGreaterThanOrEqual(0);expect(positions.getX(i)).toBeLessThanOrEqual(g.hf.width);}
  const water=view.object.children[1] as THREE.Mesh;expect(water.material instanceof THREE.ShaderMaterial).toBe(false);
  view.object.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(material=>material.dispose());}});
});
