import { AURAS } from '../core/auras';
import type { PlayerId, UnitKind } from '../core/types';
import { HERO_COOLDOWN, isHero, UNITS } from '../core/units';
import { heroBlock, heroCooldownLeft, heroOf } from '../sim/systems/heroes';
import type { World } from '../sim/World';

/** "1:05" for 65 seconds (rounded up, so "0:01" until it is really ready). */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Tooltip note on a hero's train tile: its aura, in plain words. */
export function heroTileNote(kind: UnitKind): string {
  const aura = UNITS[kind].auras?.[0];
  const rule = `Hero: one at a time, ${clockText(HERO_COOLDOWN)} to replace after it falls`;
  return aura ? `${AURAS[aura].name}: ${AURAS[aura].description} ${rule}` : rule;
}

/** Why a hero train tile is locked for `owner` right now ('' when it is not). */
export function heroLockText(world: World, owner: PlayerId, kind: UnitKind): string {
  if (!isHero(kind)) return '';
  const block = heroBlock(world, owner);
  if (block === 'limit') return 'Your hero is already in the field';
  if (block === 'hero-cooldown') return `Ready in ${clockText(heroCooldownLeft(world, owner))}`;
  return '';
}

/** What the side-rail hero button shows: the living hero, or the cooldown after it fell. */
export type HeroSlot =
  | { state: 'none' }
  | { state: 'alive'; id: number; kind: UnitKind; hp: number }
  | { state: 'cooldown'; left: number };

export function heroSlot(world: World, owner: PlayerId): HeroSlot {
  const hero = heroOf(world, owner);
  if (hero) return { state: 'alive', id: hero.id, kind: hero.kind, hp: hero.maxHp > 0 ? hero.hp / hero.maxHp : 0 };
  const left = heroCooldownLeft(world, owner);
  return left > 0 ? { state: 'cooldown', left } : { state: 'none' };
}

/** "Leonidas has fallen! A new hero can be trained in 2:00." */
export function heroDeathText(kind: UnitKind): string {
  return `${UNITS[kind].name} has fallen! A new hero can be trained in ${clockText(HERO_COOLDOWN)}.`;
}
