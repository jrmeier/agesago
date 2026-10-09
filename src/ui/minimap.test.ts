import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RtsCamera } from '../camera/RtsCamera';
import { GRASS_ONLY, type GroundWeights, type Heightfield } from '../core/types';
import { testField } from '../input/testField';
import {
  dominantGround,
  footprintKey,
  GROUND_TINT,
  groundColor,
  hillShade,
  mapToWorld,
  renderTerrain,
  terrainColor,
  waterColor,
  worldToMap,
} from './minimapMath';

const box = { w: 320, h: 240, mapW: 160, mapD: 120 };
const only = (k: keyof GroundWeights): GroundWeights => ({ ...GRASS_ONLY, grass: 0, [k]: 1 });

describe('minimap coordinates', () => {
  it('maps world corners and centre to the box (z down)', () => {
    expect(worldToMap({ x: 0, z: 0 }, box)).toEqual({ u: 0, v: 0 });
    expect(worldToMap({ x: 160, z: 120 }, box)).toEqual({ u: 320, v: 240 });
    expect(worldToMap({ x: 80, z: 30 }, box)).toEqual({ u: 160, v: 60 });
  });

  it('round-trips and clamps outside clicks to the map', () => {
    const p = { x: 37.5, z: 91.25 };
    const m = worldToMap(p, box);
    const back = mapToWorld(m.u, m.v, box);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.z).toBeCloseTo(p.z);
    expect(mapToWorld(-10, 500, box)).toEqual({ x: 0, z: 120 });
  });
});

describe('minimap terrain colours', () => {
  it('classifies the dominant material', () => {
    expect(dominantGround(GRASS_ONLY)).toBe('grass');
    expect(dominantGround({ ...GRASS_ONLY, grass: 0.2, rock: 0.7, sand: 0.1 })).toBe('rock');
    expect(dominantGround(only('path'))).toBe('path');
  });

  it('blends material tints by weight', () => {
    expect(groundColor(only('sand'))).toEqual(GROUND_TINT.sand);
    const mix = groundColor({ ...GRASS_ONLY, grass: 1, forest: 1 });
    for (let i = 0; i < 3; i++) expect(mix[i]).toBeCloseTo((GROUND_TINT.grass[i] + GROUND_TINT.forest[i]) / 2);
    expect(groundColor({ ...GRASS_ONLY, grass: 0 })).toEqual(GROUND_TINT.grass);
  });

  it('greens are green, sand is light, forest darker than grass', () => {
    const [r, g, b] = GROUND_TINT.grass;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    const lum = (c: number[]) => c[0] + c[1] + c[2];
    expect(lum(GROUND_TINT.sand)).toBeGreaterThan(lum(GROUND_TINT.grass));
    expect(lum(GROUND_TINT.forest)).toBeLessThan(lum(GROUND_TINT.grass));
  });

  it('darkens water with depth', () => {
    const shallow = waterColor(0.1);
    const deep = waterColor(5);
    expect(deep[0] + deep[1] + deep[2]).toBeLessThan(shallow[0] + shallow[1] + shallow[2]);
    expect(shallow[2]).toBeGreaterThan(shallow[0]);
    expect(waterColor(50)).toEqual(waterColor(5));
  });

  it('shades slopes facing the north-west light brighter', () => {
    expect(hillShade(0, 0)).toBeCloseTo(1);
    // Ground rising toward +x/+z faces −x/−z, i.e. toward the light.
    expect(hillShade(0.8, 0.8)).toBeGreaterThan(1);
    expect(hillShade(-0.8, -0.8)).toBeLessThan(1);
  });

  it('colours water cells blue and land cells by material', () => {
    const hf = testField();
    const water = terrainColor(hf, 10, 10);
    expect(water[2]).toBeGreaterThan(water[0]);
    const land = terrainColor(hf, 40, 30);
    expect(land[1]).toBeGreaterThan(land[2]);
  });

  it('rasterises a full opaque image', () => {
    const hf: Heightfield = { ...testField(true), width: 8, depth: 6 };
    const px = renderTerrain(hf, 16, 12);
    expect(px.length).toBe(16 * 12 * 4);
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255);
  });
});

describe('view footprint', () => {
  const make = (aspect: number) => {
    const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 400);
    return new RtsCamera(cam, testField(true), { x: 32, z: 24 });
  };

  it('is a trapezoid around the target, wider at the far (top) edge', () => {
    const rts = make(16 / 9);
    const [tl, tr, br, bl] = rts.viewFootprint();
    expect(tl.z).toBeLessThan(24);
    expect(bl.z).toBeGreaterThan(24);
    expect(tl.z).toBeCloseTo(tr.z);
    expect(bl.z).toBeCloseTo(br.z);
    expect(tl.x).toBeLessThan(32);
    expect(tr.x).toBeGreaterThan(32);
    expect(tr.x - tl.x).toBeGreaterThan(br.x - bl.x);
    expect((tl.x + tr.x) / 2).toBeCloseTo(32);
  });

  it('grows with zoom distance and follows focusOn', () => {
    const rts = make(4 / 3);
    const width = () => {
      const q = rts.viewFootprint();
      return q[1].x - q[0].x;
    };
    const near = width();
    rts.distance = 38;
    rts.settle();
    expect(width()).toBeGreaterThan(near);

    rts.focusOn({ x: 10, z: 12 });
    expect(rts.target).toEqual({ x: 10, z: 12 });
    const q = rts.viewFootprint();
    expect((q[0].x + q[1].x) / 2).toBeCloseTo(10);
    rts.focusOn({ x: -50, z: 999 });
    expect(rts.target).toEqual({ x: 0, z: 48 });
  });

  it('keys change only when the view moves', () => {
    const rts = make(1.5);
    const a = footprintKey(rts.viewFootprint());
    expect(footprintKey(rts.viewFootprint())).toBe(a);
    rts.focusOn({ x: 33, z: 24 });
    expect(footprintKey(rts.viewFootprint())).not.toBe(a);
  });
});
