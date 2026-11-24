/**
 * 17: T119 mirrored two-player land (SaveData.land, core/maps LAND_VERSION). Older saves were made on
 *    land 1 and regenerate it.
 * 16: M7-4 AI difficulty on players. Older saves load AI as moderate, retaining saved teams.
 * 15: M16-6 heroes: per-player retrain cooldown (PlayerState.heroReadyAt). Older saves load ready (0).
 * 14: M18-4 building capture (Building.capture points per player, CombatState.capture). Older
 *    saves load with every building's points all its owner's and nobody capturing.
 * 13: M15-4 batch training (Building.queueCounts); older saves load every queue entry as 1 unit.
 * 12: M17-3 guard order (CombatState.order 'guard' with CombatState.guard); older saves have no guards.
 * 11: M17-2 patrol routes on units (Unit.patrol); older saves have none.
 * 10: M17-1 group formations (Unit.formation: id, shared speed cap, arrival facing, slot).
 * 9: M16-2 siege engines (Unit.deployed, Unit.packTimer, 'packing'/'unpacking' states). Older
 *    saves hold no siege, so they load with no pack state.
 * 8: M16-7 wonder victory (match wonderRules, systems.wonder countdown, Building.completedAt).
 *    Older saves load with the default rules (on, 300 s) and no countdown.
 * 7: M15-5 loot totals per player (PlayerState.looted; older saves load with zero).
 * 6: M14-5 repair (toRepair/repairing unit states, per-player fractional repair debt).
 * 5: M14-2 upgrade chains. The academy's Guard/Fortress Tower techs became per-building tiers:
 *    older saves that researched them load with every watch tower at the matching tier.
 * 4: M15-1 veterancy (unit xp/rank, damage log). Older saves load with every unit at rank 0, xp 0.
 * 3: M14-1 in-place building upgrades (Building.tier, Building.upgrading).
 * 2: M8 research (researched techs, ages, market prices, building research queues).
 */
export const SAVE_VERSION = 17;
/** Oldest version that still loads; v2 buildings load at tier 0 with no upgrade running, v2–9 units out of formation. */
export const MIN_SAVE_VERSION = 2;

