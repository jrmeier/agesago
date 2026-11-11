import { AURAS, type AuraId } from '../core/auras';

/** One active aura as the selection panel shows it: the source's icon, name and description. */
export interface AuraChip {
  id: AuraId;
  icon: string;
  name: string;
  title: string;
}

/** Selection-panel chips for the auras active on an entity (M16-4), in the order given. */
export function auraChips(ids: readonly AuraId[]): AuraChip[] {
  return ids.map((id) => {
    const a = AURAS[id];
    const icon = 'unit' in a.source ? `#i-${a.source.unit}` : `#i-b-${a.source.building}`;
    return { id, icon, name: a.name, title: `${a.name}: ${a.description}` };
  });
}
