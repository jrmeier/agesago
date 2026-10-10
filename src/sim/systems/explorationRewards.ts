import type { EntityId, PlayerId, PropPlacement, Vec2 } from '../../core/types';
import { isAnimal, isShip } from '../../core/units';
import { TECHS, type TechId } from '../../core/techs';
import type { World } from '../World';
import { orderMove } from './movement';
import { completeResearch } from './research';
import { unitMaxHp } from './stats';
import { releaseCombat } from './combat';
import { releaseTrade } from './market';

export interface ExplorationSite {
  id: string;
  kind: 'treasure' | 'relic';
  pos: Vec2;
  claimedBy?: PlayerId;
  carrier?: EntityId;
  temple?: EntityId;
}
export interface PriestOrder { type: 'heal' | 'convert'; target: EntityId; progress: number }
export const RELIC_GOLD_PER_SECOND = 0.5;
export const PRIEST_RANGE = 5;
export const CONVERSION_SECONDS = 12;

/** Stable clusters of the actual scenery; the same seed has the same rewards on every client. */
export function explorationSites(props: readonly PropPlacement[]): ExplorationSite[] {
  const sites: ExplorationSite[] = [];
  for (const kind of ['treasure', 'relic'] as const) {
    const points = props.filter(p => kind === 'treasure' ? p.kind === 'ruinWall' || p.kind === 'ruinColumn' : p.kind === 'standingStone');
    const seen = new Set<number>();
    for (let i = 0; i < points.length; i++) {
      if (seen.has(i)) continue;
      const group = [i]; seen.add(i);
      for (let n = 0; n < group.length; n++) for (let j = 0; j < points.length; j++) {
        if (!seen.has(j) && distance(points[group[n]].pos, points[j].pos) <= 7) { seen.add(j); group.push(j); }
      }
      if (group.length < 2) continue;
      const center = { x: 0, z: 0 };
      for (const j of group) { center.x += points[j].pos.x / group.length; center.z += points[j].pos.z / group.length; }
      sites.push({ id: `${kind}:${sites.length}`, kind, pos: center });
    }
  }
  return sites;
}
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

export function orderPriest(world: World, ids: EntityId[], type: PriestOrder['type'], targetId: EntityId, by: PlayerId): void {
  const target = world.units.get(targetId);
  const valid = target && target.owner > 0 && target.state !== 'garrisoned' && !isAnimal(target.kind) && !isShip(target.kind)
    && (type === 'convert' ? world.areEnemies(by, target.owner) : !world.areEnemies(by, target.owner) && target.hp < target.maxHp)
    && world.visibilityOf(by).isVisible(target.pos.x, target.pos.z);
  const priests = ids.flatMap(id => { const u = world.units.get(id); return u?.owner === by && u.kind === 'priest' ? [u] : []; });
  if (!valid || !priests.length) { world.events.emit({ type: 'rejected', reason: 'invalid-target' }); return; }
  releaseCombat(world, priests.map(u => u.id));
  for (const u of priests) {
    world.priestOrders.set(u.id, { type, target: targetId, progress: 0 });
    u.path = []; world.setState(u, 'idle');
  }
}

/** First unit to reach a ruin wins. Priests collect relics and deposit them near an own temple. */
export function explorationRewardSystem(world: World, dt: number): void {
  for (const site of world.exploration.values()) {
    if (site.kind === 'treasure') {
      if (site.claimedBy !== undefined) continue;
      for (const u of world.units.values()) {
        if (u.owner <= 0 || u.state === 'garrisoned' || distance(u.pos, site.pos) > 4) continue;
        site.claimedBy = u.owner;
        const p = world.players.get(u.owner)!;
        const queued = new Set([...world.buildings.values()].filter(b => b.owner === u.owner).flatMap(b => b.research ?? []));
        const eligible = (['bronzeAxe', 'stoneChisels', 'bronzePicks', 'donkeyPacks'] as TechId[])
          .find(t => TECHS[t] && TECHS[t].age <= p.age && !p.researched.has(t) && !queued.has(t));
        // Alternate resource and knowledge caches; no random rolls or expensive scans every tick.
        let reward = '120 gold and 80 wood';
        if (Number(site.id.split(':')[1]) % 2 && eligible) { completeResearch(world, u.owner, eligible); reward = TECHS[eligible].name; }
        else { p.stock.gold += 120; p.stock.wood += 80; }
        world.events.emit({ type: 'treasure', owner: u.owner, site: site.id, pos: { ...site.pos }, reward });
        if (u.owner === world.localPlayer) world.emitStock();
        break;
      }
      continue;
    }
    if (site.temple !== undefined) {
      const temple = world.buildings.get(site.temple);
      if (temple?.complete && temple.kind === 'temple' && temple.owner === site.claimedBy) {
        world.stockOf(temple.owner).gold += RELIC_GOLD_PER_SECOND * dt;
        continue;
      }
      site.temple = undefined; site.claimedBy = undefined;
    }
    if (site.carrier !== undefined) {
      const priest = world.units.get(site.carrier);
      if (!priest || priest.hp <= 0) { site.carrier = undefined; site.claimedBy = undefined; continue; }
      site.pos = { ...priest.pos };
      for (const b of world.buildings.values()) {
        if (b.kind !== 'temple' || b.owner !== priest.owner || !b.complete || distance(b.pos, priest.pos) > b.radius + 1.3) continue;
        site.temple = b.id; site.claimedBy = priest.owner; site.carrier = undefined; site.pos = { ...b.pos }; priest.relic = undefined;
        world.events.emit({ type: 'relic', owner: priest.owner, site: site.id, templeId: b.id });
        break;
      }
    } else {
      for (const u of world.units.values()) {
        if (u.kind !== 'priest' || u.owner <= 0 || u.relic || u.state === 'garrisoned' || distance(u.pos, site.pos) > 4) continue;
        site.carrier = u.id; site.claimedBy = u.owner; u.relic = site.id; break;
      }
    }
  }
  for (const [id, order] of world.priestOrders) {
    const u = world.units.get(id); const target = world.units.get(order.target);
    if (!u || !target || u.kind !== 'priest' || u.state === 'garrisoned' || target.state === 'garrisoned'
      || !world.visibilityOf(u.owner).isVisible(target.pos.x, target.pos.z)
      || (order.type === 'convert' ? !world.areEnemies(u.owner, target.owner) : world.areEnemies(u.owner, target.owner) || target.hp >= target.maxHp)) {
      world.priestOrders.delete(id); continue;
    }
    if (distance(u.pos, target.pos) > PRIEST_RANGE) {
      order.progress = 0;
      if (!u.path.length) orderMove(world, [u.id], target.pos);
      continue;
    }
    u.path = []; world.setState(u, 'idle');
    if (order.type === 'heal') { target.hp = Math.min(target.maxHp, target.hp + 4 * dt); continue; }
    order.progress += dt;
    if (order.progress + 1e-9 < CONVERSION_SECONDS) continue;
    if (world.popOf(u.owner) >= world.popCapOf(u.owner)) { world.priestOrders.delete(id); world.events.emit({ type: 'rejected', reason: 'pop-cap' }); continue; }
    const previousOwner = target.owner;
    releaseCombat(world, [target.id]); releaseTrade(world, [target.id]);
    world.gatherState.delete(target.id); world.buildState.delete(target.id); world.exploreState.delete(target.id); world.exploreQueue.delete(target.id);
    world.fleeState.delete(target.id); world.priestOrders.delete(target.id);
    const ratio = target.hp / target.maxHp;
    target.owner = u.owner; target.maxHp = unitMaxHp(world, u.owner, target.kind); target.hp = Math.max(1, target.maxHp * ratio);
    target.target = null; target.path = []; target.gatherNode = null; target.gatherType = null; target.state = 'idle';
    world.priestOrders.delete(id);
    world.events.emit({ type: 'converted', owner: u.owner, id: target.id, previousOwner });
    // Remount cloth and ownership-sensitive picking; entity identity and sim state stay intact.
    world.events.emit({ type: 'removed', id: target.id }); world.events.emit({ type: 'spawned', id: target.id, kind: target.kind });
    world.refreshFog(); world.emitStock();
  }
}
