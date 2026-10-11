import { productionSystem } from '../sim/systems/production';
import { describe,it,expect } from 'vitest';
import { CIVS,CIV_IDS } from './civilizations';
import { TECHS } from './techs';
import { trainable,UNITS } from './units';
import { generateMap } from '../sim/mapgen';
import { World,defaultPlayers } from '../sim/World';
import { statOf, researchBlock,completeResearch } from '../sim/systems/research';
import { serializeWorld,deserializeWorld } from '../sim/serialize';
import { createSoldier } from '../render/models';

describe('civilizations',()=> {
  it.each(CIV_IDS)('%s owns one gated unique unit, tech and modifier-backed bonus',civ=> {
    const g=generateMap(4,2,{size:'small',type:'forest'});const world=new World(g.hf,g.layout,defaultPlayers(2,[civ]));world.seed=4;world.mapOptions={size:'small',type:'forest'};
    const spec=CIVS[civ],unit=UNITS[spec.unit];
    expect(trainable(unit.trainedAt!,civ)).toContain(spec.unit);expect(trainable(unit.trainedAt!)).not.toContain(spec.unit);
    world.players.get(1)!.age=1;world.players.get(2)!.age=1;
    expect(researchBlock(world,2,spec.tech,true)).toBe('requires');expect(researchBlock(world,1,spec.tech,true)).toBe(null);
    for(const effect of spec.bonuses) {
      const subject=effect.target==='allBuildings'?{building:'house' as const}:effect.target==='class:infantry'?{unit:'hoplite' as const}:{unit:'villager' as const};
      expect(statOf(world,1,subject,effect.stat,100)).toBeCloseTo(effect.op==='mul'?100*effect.value:100+effect.value);
    }
    completeResearch(world,1,spec.tech);expect(world.players.get(1)!.researched.has(spec.tech)).toBe(true);
    Object.assign(world.stock,{food:1000,wood:1000,gold:1000,stone:1000});
    const camp={...world.townCenter!,id:world.allocId(),kind:unit.trainedAt!,queue:0,progress:0};world.buildings.set(camp.id,camp);
    world.dispatch({type:'train',buildingId:camp.id,unit:spec.unit});
    expect(camp.queueKinds).toEqual([spec.unit]);productionSystem(world,unit.trainTime+1);
    expect([...world.units.values()].some(u=>u.kind===spec.unit&&u.owner===1)).toBe(true);
    const restored=deserializeWorld(serializeWorld(world));expect(restored.players.get(1)!.player.civ).toBe(civ);
    expect(TECHS[spec.tech].civ).toBe(civ);
    const model=createSoldier(spec.unit as Parameters<typeof createSoldier>[0]);expect(model.object.name).toBe(spec.unit);expect(model.object.userData.civilizationUnit).toBe(spec.unit);
    model.setPose('attack',.4);model.setPose('die',.5,{progress:.5});
    const torso=model.object.getObjectByName('tunic-head-armor') as import('three').Mesh;expect(torso.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(torso.geometry.userData.tintRoles).toBeDefined();
  });
});

it('architecture palettes keep draw counts and shared base colours unchanged',async()=> {
  const {createBuildingVisual}=await import('../render/buildingVisuals');
  const colors=(obj:ReturnType<typeof createBuildingVisual>['object'])=>{const values:number[]=[];obj.traverse(o=>{if('geometry' in o){const g=(o as import('three').Mesh).geometry;const c=g.getAttribute('color');if(c)values.push(c.getX(0),c.getY(0),c.getZ(0));}});return values};
  const base=createBuildingVisual('townCenter');const before=colors(base.object);
  const roman=createBuildingVisual('townCenter',undefined,0,'romans');const celt=createBuildingVisual('townCenter',undefined,0,'celts');
  expect(colors(roman.object)).not.toEqual(colors(celt.object));expect(colors(base.object)).toEqual(before);
  expect(colors(roman.object).length).toBe(before.length);
  roman.setTier(1);expect(roman.object.getObjectByName('finished')?.userData.civilization ?? roman.object.children.some(c=>c.userData.civilization==='romans')).toBeTruthy();
});


it('implicit barracks training uses an available basic unit before the unique unit age',()=> {
  const g=generateMap(4,1,{size:'small',type:'forest'});
  const w=new World(g.hf,g.layout,defaultPlayers(1,['hellenes']));
  Object.assign(w.stock,{food:100,wood:100});
  const barracks={...w.townCenter!,id:w.allocId(),kind:'barracks' as const,queue:0,progress:0};w.buildings.set(barracks.id,barracks);
  w.dispatch({type:'train',buildingId:barracks.id});expect(barracks.queueKinds).toEqual(['hoplite']);
  w.dispatch({type:'train',buildingId:barracks.id,unit:'phalangiteGuard'});expect(barracks.queueKinds).toEqual(['hoplite']);
});
