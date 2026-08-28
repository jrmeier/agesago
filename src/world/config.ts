import { TileType } from '../game/constants';

/** Sea level in world units. Land tiles rise above this; water shows the sea plane. */
export const SEA_LEVEL = 0;

/** Top surface height for each land terrain type (world units above sea level). */
export const TILE_HEIGHT: Record<Exclude<TileType, 'water'>, number> = {
  sand: 0.18,
  grass: 0.42,
  forest: 0.42,
  dirt: 0.66,
};

/** Base color palette for terrain, tuned for a warm low-poly look. */
export const TILE_COLOR: Record<Exclude<TileType, 'water'>, number[]> = {
  grass: [0x6aa84f, 0x5f9a47, 0x74b356, 0x5a923f],
  sand: [0xe4c98a, 0xd9bb78],
  dirt: [0x9c7a3c, 0x8a6c34],
  forest: [0x4f8a3c, 0x468033],
};

export const SKY_TOP = 0x8fc3e8;
export const SKY_HORIZON = 0xd8ebf5;
export const SUN_COLOR = 0xfff2d6;
export const WATER_COLOR = 0x2f7ea6;
export const WATER_DEEP = 0x1c5c82;

/** How far land tiles extend downward, so the terrain reads as solid blocks. */
export const TILE_BASE = -1.4;

export const TREE_TRUNK = 0x6b4a2b;
export const TREE_FOLIAGE = [0x3f7a34, 0x357029, 0x498a3a];
