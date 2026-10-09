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
  /** Gap kept between a villager's edge and the node / building it walks up to. */
  approachGap: 0.15,
  /** How far beyond a footprint's edge a villager may stand and still work / deposit. */
  reach: 0.8,
  /** Search radius for the next node of the same type when one runs out. */
  retargetRadius: 15,
  /** Group move ring offsets: unit i stands formationBase + formationStep·√i from the target. */
  formationBase: 0.6,
  formationStep: 0.35,
} as const;
