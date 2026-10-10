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
