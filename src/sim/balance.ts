/** Gameplay tuning numbers. Owned by the Sim lane (T3). */
export const BALANCE = {
  /** Sim ticks per second (fixed step). */
  tickRate: 20,
  villagerSpeed: 2.4,
  villagerSpeedLoaded: 2.0,
  /** Scouts are fast explorers (and never carry anything). */
  scoutSpeed: 5.5,
  carryCap: 10,
  /** Seconds per resource unit gathered (default; see gatherIntervals). */
  gatherInterval: 0.8,
  /** Seconds per unit by resource: quarrying stone is a little slower. */
  gatherIntervals: { wood: 0.8, food: 0.8, gold: 0.8, stone: 0.95 },
  /** Seconds per unit of food harvested from a farm (berries are 0.8). */
  farmInterval: 0.85,
  trainCost: { food: 50 },
  trainTime: 8,
  /**
   * Legacy display value only. The real cap is World.popCap (houses + Town Center, ≤ MAX_POP),
   * which 'train' enforces.
   */
  popCap: 25,
  /** Construction exponent: progress/s = builders^buildExponent / buildTime (diminishing returns). */
  buildExponent: 0.75,
  /** Builders of a group order spread along the footprint edge this far apart. */
  builderSpacing: 0.8,
  /** Footprint sample spacing for placement terrain checks. */
  placementSample: 0.5,
  /** A farmer stands this far inside the field edge. */
  farmInset: 0.6,
  startingStock: { wood: 0, food: 0, gold: 0, stone: 0 },
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
  /** A foundation starts at this fraction of its max hp; construction adds the rest. */
  foundationHp: 0.1,

  // ---- Combat ----
  /** Chasers give up once this far from where they last had the target in range (or first acquired it). */
  leash: 20,
  /** Seconds between chase re-paths for one unit. */
  repathInterval: 0.4,
  /** Re-path a chase only if the target's approach point moved this far from the path's end. */
  repathDistance: 1,
  /** Idle units look for enemies every this many ticks (staggered by id). */
  scanTicks: 5,
  /** Projectile speed (world units / s): flight time = distance / projectileSpeed. */
  projectileSpeed: 18,
  /** A projectile hits if the target is still within this radius of the aim point when it lands. */
  hitRadius: 0.8,
  /** Ranged units step back when a melee attacker closes within this edge distance… */
  kiteDistance: 1.5,
  /** …by this far. */
  kiteStep: 2.5,
  /** Villagers hit while working run this far from the attacker, then resume. */
  fleeDistance: 4,
  /** At most one 'attacked' alert per player per this many seconds. */
  alertInterval: 3,
  /** Units keep after a target this long after losing sight of it (e.g. an archer shooting from the fog). */
  lostSightGrace: 2,
} as const;
