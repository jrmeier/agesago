export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;

/** Isometric tile dimensions (2:1 ratio). */
export const ISO_TILE_W = 64;
export const ISO_TILE_H = 32;

/** @deprecated Use ISO_TILE_W — kept for any legacy refs */
export const TILE_SIZE = ISO_TILE_W;

export const COLORS = {
  grass: [0x4a7c3f, 0x3d6b35, 0x528848, 0x456f3c],
  dirt: [0x8b6914, 0x7a5c12, 0x9a7518],
  water: [0x2a6b8a, 0x1e5570, 0x3580a0],
  sand: [0xc4a35a, 0xb8934e],
  tree: { trunk: 0x5c3d1e, foliage: [0x2d5a27, 0x3a7032, 0x256020] },
  villager: { body: 0xc4956a, tunic: 0x8b4513, head: 0xe8c4a0 },
  selection: 0xd4a843,
  moveMarker: 0x6ecfff,
} as const;

export type TileType = 'grass' | 'dirt' | 'water' | 'sand' | 'forest';

/** Terrain types used for autotile base + transitions (forest → grass). */
export type AutotileTerrain = 'grass' | 'dirt' | 'water' | 'sand';

export interface TileData {
  type: TileType;
  elevation: number;
  moisture: number;
}

/** Map grid type → autotile terrain for rendering. */
export function toAutotileTerrain(type: TileType): AutotileTerrain {
  if (type === 'forest') return 'grass';
  return type;
}
