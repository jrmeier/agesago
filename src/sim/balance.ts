/** Gameplay tuning numbers. Owned by the Sim lane (T3). */
export const BALANCE = {
  /** Sim ticks per second (fixed step). */
  tickRate: 20,
  villagerSpeed: 2.4,
  villagerSpeedLoaded: 2.0,
  carryCap: 10,
  /** Seconds per resource unit gathered. */
  gatherInterval: 0.8,
  trainCost: { food: 50 },
  trainTime: 8,
  popCap: 25,
  startingStock: { wood: 0, food: 0, gold: 0 },
  villagerRadius: 0.3,
  townCenterRadius: 1.6,
} as const;
