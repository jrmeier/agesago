import { describe, expect, it } from 'vitest';
import { footprintRadius } from '../core/buildings';
import { GRASS_ONLY, type Building, type Heightfield, type MapLayout, type UnitKind, type Vec2 } from '../core/types';
import { UNITS } from '../core/units';
import { World } from './World';
import { deserializeWorld, serializeWorld } from './serialize';
import { buildingRect } from './systems/sites';
import { FISHING_CAPACITY, TRANSPORT_CAPACITY } from './systems/naval';
import { killUnit } from './systems/combat';

const water = (x: number, z: number) => (x >= 30 && x <= 70) || (Math.hypot(x - 85, z - 15) < 4);
const hf: Heightfield = { width: 100, depth: 80, heightAt: (x,z) => water(x,z) ? -2 : 1, isWater: water,
  isWalkable: (x,z) => x >= 0 && z >= 0 && x <= 100 && z <= 80 && !water(x,z), forestDensity: () => 0, ground: () => GRASS_ONLY };
function world() {
  const layout: MapLayout = { townCenter: { x: 10, z: 60 }, villagers: [], scouts: [], props: [],
    extraStarts: [{ townCenter: { x: 90, z: 60 }, villagers: [], scouts: [] }],
    nodes: [{ kind: 'fish', pos: { x: 45, z: 20 }, amount: 60 }] };
  const w = new World(hf, layout); w.seed = 1; w.visibility.state.fill(2); w.players.get(1)!.age = 1; w.stock.wood = 3000; return w;
}
function dock(w: World, pos: Vec2, owner = 1): Building {
  const b: Building = { id: w.allocId(), kind: 'dock', pos, owner, hp: 1200, maxHp: 1200, rot: 0,
    radius: footprintRadius('dock'), complete: true, buildProgress: 1, queue: 0, progress: 0 };
  w.buildings.set(b.id,b); w.nav.addRect(b.id, buildingRect(b)); w.waterNav.addRect(b.id,buildingRect(b)); return b;
}
function run(w: World, seconds: number) { for (let i=0;i<seconds*20;i++) w.tick(.05); }

describe('water navigation and docks', () => {
  it('builds docks only across shorelines and trains every ship on water', () => {
    const w=world(); expect(w.canPlace('dock',{x:30,z:20},0).ok).toBe(true);
    expect(w.canPlace('dock',{x:15,z:20},0).ok).toBe(false); expect(w.canPlace('dock',{x:50,z:20},0).ok).toBe(false);
    const b=dock(w,{x:30,z:20}); w.stock.gold=3000; w.stock.food=3000;
    // Room for all ship kinds without changing the simulation's population rule.
    for (const kind of ['fishingBoat','merchantShip','trireme','transport'] as UnitKind[]) {
      w.dispatch({type:'train',buildingId:b.id,unit:kind}); run(w,UNITS[kind].trainTime+.1);
      const ship=[...w.units.values()].find(u=>u.kind===kind)!; expect(ship).toBeDefined(); expect(hf.isWater(ship.pos.x,ship.pos.z)).toBe(true);
    }
  });
  it('keeps ships off land and land units out of the sea; disconnected water is unreachable', () => {
    const w=world(); const ship=w.spawnUnit('transport',{x:35,z:40}); const villager=w.spawnUnit('villager',{x:20,z:40});
    w.dispatch({type:'move',unitIds:[ship.id,villager.id],target:{x:65,z:40}}); run(w,15);
    expect(ship.pos.x).toBeGreaterThan(60); expect(hf.isWater(ship.pos.x,ship.pos.z)).toBe(true); expect(villager.pos.x).toBeLessThan(30);
    expect(w.waterNav.findPath(ship.pos,{x:85,z:15})).toBeNull(); expect(w.nav.findPath(villager.pos,{x:80,z:40})).toBeNull();
  });
});
describe('naval economy', () => {
  it('hauls water fish to a dock, depletes it once, and saves midway through a trip', () => {
    const w=world(); dock(w,{x:30,z:20}); const boat=w.spawnUnit('fishingBoat',{x:34,z:20}); const fish=[...w.nodes.values()][0];
    const food=w.stock.food; w.dispatch({type:'gather',unitIds:[boat.id],nodeId:fish.id}); run(w,20);
    expect(boat.carry!.amount).toBeGreaterThan(0); expect(boat.carry!.amount).toBeLessThanOrEqual(FISHING_CAPACITY);
    const loaded=deserializeWorld(serializeWorld(w),hf); expect(serializeWorld(loaded)).toEqual(serializeWorld(w));
    run(loaded,120); expect(loaded.stock.food-food).toBe(60); expect(loaded.nodes.has(fish.id)).toBe(false);
  });
  it('trades between own docks for distance-scaled gold and rejects enemy docks', () => {
    const w=world(); dock(w,{x:30,z:10}); const far=dock(w,{x:70,z:70}); const enemy=dock(w,{x:70,z:10},2);
    const ship=w.spawnUnit('merchantShip',{x:34,z:10}); const gold=w.stock.gold;
    w.dispatch({type:'navalTrade',unitIds:[ship.id],dockId:enemy.id}); expect(w.navalJobs.has(ship.id)).toBe(false);
    w.dispatch({type:'navalTrade',unitIds:[ship.id],dockId:far.id}); run(w,65); expect(w.stock.gold).toBeGreaterThan(gold+50);
    w.buildings.delete(far.id); w.tick(.05); expect(w.navalJobs.has(ship.id)).toBe(false);
  });
});
describe('transports and triremes', () => {
  it('boards land units, saves cargo and unloads onto the other island in distinct land slots', () => {
    const w=world(); const ship=w.spawnUnit('transport',{x:31,z:45}); const passengers=[0,1,2].map(i=>w.spawnUnit('villager',{x:27,z:44+i}));
    w.dispatch({type:'loadTransport',unitIds:passengers.map(p=>p.id),transportId:ship.id}); run(w,4);
    expect(ship.passengers).toHaveLength(3); expect(passengers.every(p=>p.state==='garrisoned')).toBe(true);
    w.dispatch({type:'unloadTransport',transportId:ship.id,target:{x:72,z:45}}); run(w,5);
    const loaded=deserializeWorld(serializeWorld(w),hf); expect(serializeWorld(loaded)).toEqual(serializeWorld(w)); run(loaded,20);
    expect(loaded.units.get(ship.id)!.passengers).toHaveLength(0);
    const landed=passengers.map(p=>loaded.units.get(p.id)!); expect(landed.every(p=>p.pos.x>70&&!hf.isWater(p.pos.x,p.pos.z)&&p.state==='idle')).toBe(true);
    expect(new Set(landed.map(p=>`${p.pos.x},${p.pos.z}`)).size).toBe(3);
  });
  it('enforces cargo capacity and issuer ownership, and a sunk transport loses its passengers', () => {
    const w=world(); const ship=w.spawnUnit('transport',{x:31,z:45}); const passengers=Array.from({length:12},()=>w.spawnUnit('villager',{x:29,z:45}));
    w.dispatch({type:'loadTransport',unitIds:passengers.map(p=>p.id),transportId:ship.id},2); expect(w.boarding.size).toBe(0);
    w.dispatch({type:'loadTransport',unitIds:passengers.map(p=>p.id),transportId:ship.id}); w.tick(.05); expect(ship.passengers).toHaveLength(TRANSPORT_CAPACITY);
    w.dispatch({type:'unloadTransport',transportId:ship.id,target:{x:72,z:45}},2); expect(w.landings.size).toBe(0);
    const aboard=[...ship.passengers!]; killUnit(w,ship); expect(aboard.every(id=>!w.units.has(id))).toBe(true); expect(w.units.size).toBe(2);
  });
  it('resigning with a loaded transport emits each death once', () => {
    const w=world(), ship=w.spawnUnit('transport',{x:31,z:45}), passenger=w.spawnUnit('villager',{x:29,z:45});
    const deaths:number[]=[]; w.events.on('died',e=>deaths.push(e.id));
    w.dispatch({type:'loadTransport',unitIds:[passenger.id],transportId:ship.id}); w.tick(.05);
    w.dispatch({type:'resign'});
    expect(deaths.filter(id=>id===ship.id)).toHaveLength(1); expect(deaths.filter(id=>id===passenger.id)).toHaveLength(1);
    expect(w.units.size).toBe(0);
  });
  it('sinking midway through unload leaves no dangling naval snapshot state', () => {
    const w=world(), ship=w.spawnUnit('transport',{x:31,z:45}), passenger=w.spawnUnit('villager',{x:29,z:45});
    w.dispatch({type:'loadTransport',unitIds:[passenger.id],transportId:ship.id}); w.tick(.05);
    w.dispatch({type:'unloadTransport',transportId:ship.id,target:{x:72,z:45}});
    const waiting=w.spawnUnit('villager',{x:29,z:46}); w.boarding.set(waiting.id,ship.id);
    run(w,2); killUnit(w,ship); const state=serializeWorld(w).systems;
    expect(state.landings).toEqual([]); expect(state.boarding).toEqual([]); expect(state.navalJobs).toEqual([]);
  });
  it('triremes close on enemy ships using water paths and sink them with projectiles', () => {
    const w=world(); const trireme=w.spawnUnit('trireme',{x:35,z:40}); const enemy=w.spawnUnit('merchantShip',{x:52,z:40},2);
    enemy.stance='passive'; w.updateFog();
    // Explore toward the rival before issuing an explicit target order.
    w.dispatch({type:'move',unitIds:[trireme.id],target:{x:43,z:40}}); run(w,3); w.updateFog();
    w.dispatch({type:'attack',unitIds:[trireme.id],targetId:enemy.id}); run(w,35);
    expect(w.units.has(enemy.id)).toBe(false); expect(hf.isWater(trireme.pos.x,trireme.pos.z)).toBe(true);
  });
});
