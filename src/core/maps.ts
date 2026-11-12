/** Match identity: saved with the seed so loading regenerates exactly the same terrain. */
export const MAP_SIZES = { small: 120, medium: 144, large: 176, giant: 192 } as const;
export type MapSize = keyof typeof MAP_SIZES;
export const MAP_TYPES = ['mediterranean', 'highlands', 'riverValley', 'forest', 'islands'] as const;
export type MapType = typeof MAP_TYPES[number];
export interface MapOptions { size?: MapSize; type?: MapType }
export function normalizeMapOptions(options: MapOptions = {}): Required<MapOptions> {
  if (options.size !== undefined && !Object.hasOwn(MAP_SIZES,options.size)) throw new RangeError('Invalid map size');
  if (options.type !== undefined && !MAP_TYPES.includes(options.type)) throw new RangeError('Invalid map type');
  return { size: options.size ?? 'large', type: options.type ?? 'mediterranean' };
}

/**
 * Expansion gold (M16-10, after 0 A.D.'s large metal mines): every player gets the same pair of
 * rich mine clusters on its flanks, past its starting territory (Town Center radius 22, about 28
 * in the Town Age) and nearer its own start than any rival's, so a second Town Center there pays
 * off. The starting kits and the shared neutral mines stay as they were.
 */
export const EXPANSION_GOLD = {
  /** Distance from the start, world units. */
  distance: 40,
  /**
   * Angle off the start's direction to the map centre, each side (radians): the flanks with one
   * rival, a little further back with more, away from the neighbours.
   */
  angle: Math.PI * 0.4,
  crowdedAngle: Math.PI * 0.55,
  /** Mines per cluster, laid this far apart. */
  mines: 2,
  spacing: 3,
  /** Gold per mine (a neutral mine holds 400). */
  amount: 800,
} as const;

/** Desired mine positions of both of a start's expansion clusters (placement may nudge them). */
export function expansionGoldSpots(start: { x: number; z: number }, mapCenter: { x: number; z: number }, players: number): { x: number; z: number }[] {
  const dx = mapCenter.x - start.x, dz = mapCenter.z - start.z;
  const base = dx === 0 && dz === 0 ? 0 : Math.atan2(dz, dx);
  const g = EXPANSION_GOLD;
  const spots: { x: number; z: number }[] = [];
  for (const side of [-1, 1]) {
    const a = base + side * (players > 2 ? g.crowdedAngle : g.angle);
    const c = { x: start.x + Math.cos(a) * g.distance, z: start.z + Math.sin(a) * g.distance };
    // The mines line up across the radius, so both are as far from home.
    const across = a + Math.PI / 2;
    for (let i = 0; i < g.mines; i++) {
      const o = (i - (g.mines - 1) / 2) * g.spacing;
      spots.push({ x: c.x + Math.cos(across) * o, z: c.z + Math.sin(across) * o });
    }
  }
  return spots;
}
