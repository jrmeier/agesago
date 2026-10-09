import { GAIA, type Unit, type Vec2 } from '../../core/types';
import { isAnimal, UNITS } from '../../core/units';
import type { World } from '../World';
import { orderAttack } from './combat';

export const WILDLIFE_LEASH = 5;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

/** Walk a short straight step only where navigation permits it. */
function step(world: World, animal: Unit, goal: Vec2, speed: number, dt: number): void {
  const d = distance(animal.pos, goal);
  const fraction = d > 0 ? Math.min(1, speed * dt / d) : 0;
  const next = {
    x: animal.pos.x + (goal.x - animal.pos.x) * fraction,
    z: animal.pos.z + (goal.z - animal.pos.z) * fraction,
  };
  if (!fraction || !world.nav.isFree(next) || !world.nav.lineOfSight(animal.pos, next)) {
    world.setState(animal, 'idle');
    return;
  }
  animal.facing = Math.atan2(next.x - animal.pos.x, next.z - animal.pos.z);
  animal.pos = next;
  world.setState(animal, 'moving');
}

/** Deterministic wildlife: persisted homes, flight, boar combat and current-sight herding. */
export function wildlifeSystem(world: World, dt: number): void {
  for (const animal of world.units.values()) {
    if (!isAnimal(animal.kind) || animal.hp <= 0) continue;
    const home = animal.leashAnchor ?? (animal.leashAnchor = { ...animal.pos });
    if (animal.kind === 'sheep') {
      const visible = (id: number) => !world.isDefeated(id) && world.visibilityOf(id).isVisible(animal.pos.x, animal.pos.z);
      // Keep the current keeper on simultaneous sight; Gaia ties use roster order.
      if (animal.owner === GAIA || !visible(animal.owner)) {
        for (const id of world.players.keys()) {
          if (!visible(id)) continue;
          animal.owner = id;
          world.refreshFog();
          break;
        }
      }
    }
    if (animal.state === 'attacking' || animal.path.length) continue;
    let threat: Unit | undefined;
    let nearest = 8;
    if (animal.kind !== 'sheep') {
      for (const unit of world.units.values()) {
        if (unit.owner === GAIA || unit.hp <= 0) continue;
        const d = distance(animal.pos, unit.pos);
        if (d <= nearest) { nearest = d; threat = unit; }
      }
    }
    if (threat && animal.kind === 'boar' && nearest <= 3) {
      orderAttack(world, [animal.id], threat.id, GAIA);
      continue;
    }
    if (threat) {
      const dx = animal.pos.x - threat.pos.x;
      const dz = animal.pos.z - threat.pos.z;
      const d = Math.hypot(dx, dz);
      const direction = d > 0 ? { x: dx / d, z: dz / d } : { x: 0, z: 1 };
      step(world, animal, { x: animal.pos.x + direction.x * 4, z: animal.pos.z + direction.z * 4 }, UNITS[animal.kind].speed, dt);
    } else {
      // Every six seconds choose a new interior point without mutable RNG state.
      const angle = animal.id * 2.399963 + Math.floor(world.time / 6) * 1.618034;
      const goal = { x: home.x + Math.sin(angle) * (WILDLIFE_LEASH - 1), z: home.z + Math.cos(angle) * (WILDLIFE_LEASH - 1) };
      step(world, animal, goal, 0.35, dt);
    }
  }
}
