import type { World } from '../World';
import { productionOrder } from '../productionQueue';
import { advanceResearch } from './research';
import { advanceTraining } from './train';

/** Each building spends this tick on exactly one production job. */
export function productionSystem(world: World, dt: number): void {
  for (const b of world.buildings.values()) {
    if (productionOrder(b)[0] === 'research') advanceResearch(world, b, dt);
    else advanceTraining(world, b, dt);
  }
}
