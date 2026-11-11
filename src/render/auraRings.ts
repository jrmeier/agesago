import { AURAS, type AuraId } from '../core/auras';
import { BUILDINGS } from '../core/buildings';
import type { BuildingKind, UnitKind } from '../core/types';
import { UNITS } from '../core/units';

/**
 * Radius (from the entity's centre) of the range ring drawn around a selected aura source
 * (M16-4): its widest radius aura plus its own half-size, since aura reach counts from the
 * source's edge. 0 means no ring (no auras, or only global / garrison ones).
 */
export function auraRingRadius(e: { unit: UnitKind } | { building: BuildingKind }): number {
  const ids: readonly AuraId[] | undefined = 'unit' in e ? UNITS[e.unit].auras : BUILDINGS[e.building].auras;
  let r = 0;
  for (const id of ids ?? []) {
    const reach = AURAS[id].radius;
    if (typeof reach === 'number') r = Math.max(r, reach);
  }
  if (r === 0) return 0;
  if ('unit' in e) return r + UNITS[e.unit].radius;
  const size = BUILDINGS[e.building].size;
  return r + Math.max(size.w, size.d) / 2;
}
