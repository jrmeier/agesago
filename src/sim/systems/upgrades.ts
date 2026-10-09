import { BUILDINGS } from '../../core/buildings';
import { TECHS, applyStat, type TechId } from '../../core/techs';
import type { Building, PlayerId, Unit } from '../../core/types';
import { UNITS } from '../../core/units';
import type { World } from '../World';
import { buildingMaxHp, unitMaxHp } from './stats';

/**
 * Apply a just-researched tech to `owner`'s existing entities (M8-5, Sim lane).
 * Called once by completeResearch() after `researched` already includes `tech` (and the stat
 * cache is cleared). Everything else is read live through statOf(), so only stored values need
 * refreshing: maxHp of units and buildings whose hp stat changed, keeping each one's HP ratio
 * (a unit at 50% stays at 50%). Foundations keep their ratio too, so construction still ends
 * at full health. Farm food is not topped up: farmFood upgrades apply to new farms and reseeds.
 */
export function applyResearch(world: World, owner: PlayerId, tech: TechId): void {
  if (!TECHS[tech].effects.some((e) => e.stat === 'hp')) return;
  for (const u of world.units.values()) {
    if (u.owner !== owner || !touchesHp(tech, u)) continue;
    rescale(u, unitMaxHp(world, owner, u.kind));
  }
  for (const b of world.buildings.values()) {
    if (b.owner !== owner || !touchesHp(tech, b)) continue;
    rescale(b, buildingMaxHp(world, owner, b.kind));
  }
}

/** Does `tech` change the hp stat of this entity's kind? */
function touchesHp(tech: TechId, e: Unit | Building): boolean {
  const one = new Set<TechId>([tech]);
  if ('stance' in e) return applyStat(one, { unit: e.kind }, 'hp', UNITS[e.kind].hp) !== UNITS[e.kind].hp;
  return applyStat(one, { building: e.kind }, 'hp', BUILDINGS[e.kind].hp) !== BUILDINGS[e.kind].hp;
}

/** New maxHp, same HP ratio (rounded to whole hit points; a living entity keeps at least 1). */
function rescale(e: Unit | Building, maxHp: number): void {
  if (maxHp === e.maxHp || e.maxHp <= 0) return;
  const ratio = e.hp / e.maxHp;
  e.maxHp = maxHp;
  e.hp = Math.min(maxHp, Math.max(e.hp > 0 ? 1 : 0, Math.round(maxHp * ratio)));
}
