import type { Modifier, TechId } from './techs';
import type { UnitKind } from './types';
export type CivId = 'hellenes' | 'romans' | 'persians' | 'celts';
export interface CivSpec { name: string; description: string; bonuses: Modifier[]; unit: UnitKind; tech: TechId; architecture: number }
/** Shared by setup, simulation, AI and architecture. Modest bonuses preserve counter play. */
export const CIVS: Record<CivId, CivSpec> = {
  hellenes: { name:'Hellenes',description:'Infantry train 5% faster. Phalangite Guards and disciplined formations.', bonuses:[{target:'class:infantry',stat:'trainTime',op:'mul',value:.95}],unit:'phalangiteGuard',tech:'hellenicDiscipline',architecture:0xf4e8cb },
  romans: { name:'Romans',description:'Buildings have 5% more health. Legionaries and engineering.',bonuses:[{target:'allBuildings',stat:'hp',op:'mul',value:1.05}],unit:'legionary',tech:'romanEngineering',architecture:0xd5b6a0 },
  persians:{name:'Persians',description:'Villagers gather food 5% faster. Immortals and royal roads.',bonuses:[{target:'villager',stat:'gather.food',op:'mul',value:1.05}],unit:'immortal',tech:'royalRoads',architecture:0xddc389},
  celts:{name:'Celts',description:'Villagers gather wood 5% faster. Raiders and woodland craft.',bonuses:[{target:'villager',stat:'gather.wood',op:'mul',value:1.05}],unit:'raider',tech:'woodlandCraft',architecture:0x997b52},
};
export const CIV_IDS = Object.keys(CIVS) as CivId[];
export function civFor(value: unknown): CivId | undefined { return typeof value==='string' && Object.hasOwn(CIVS,value) ? value as CivId : undefined }
