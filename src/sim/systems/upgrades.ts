import type { TechId } from '../../core/techs';
import type { PlayerId } from '../../core/types';
import type { World } from '../World';

/**
 * Apply a just-researched tech to `owner`'s existing entities (M8-5, Sim lane).
 * Called once by completeResearch() after `researched` already includes `tech`.
 *
 * TODO(sim lane): refresh maxHp of affected units and buildings keeping the HP ratio;
 * nothing else should need touching here because systems read stats through statOf().
 */
export function applyResearch(_world: World, _owner: PlayerId, _tech: TechId): void {}
