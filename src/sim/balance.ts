/** Gameplay tuning numbers. Owned by the Sim lane (T3). */
export const BALANCE = {
  /** Sim ticks per second (fixed step). */
  tickRate: 20,
  villagerSpeed: 2.4,
  villagerSpeedLoaded: 2.0,
  /** Scouts are fast explorers (and never carry anything). */
  scoutSpeed: 5.5,
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
  /** Frontier searches (BFS over the nav grid) the explore system may run per tick, across all units. */
  exploreSearchesPerTick: 3,
  /** Stop planning further explorers this tick once their searches cost this much (≈ BFS cells; ~1 ms on desktop). */
  exploreWorkPerTick: 40000,
  /** Weighted-A* factor for explore paths (targets can be far; a slightly longer route is fine). */
  explorePathGreed: 1.5,
  /** Explore targeting: score = distance · (1 + forwardBias · (1 − cos angle to heading) / 2). */
  exploreForwardBias: 1,
} as const;
