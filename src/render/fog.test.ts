import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { qualityTier } from '../core/quality';
import { GRASS_ONLY, type GroundWeights, type Heightfield, type PropKind, type PropPlacement } from '../core/types';
import { EXPLORED, Visibility } from '../sim/visibility';
import { World } from '../sim/World';
import { EntityViews } from './EntityViews';
import { applyFog, createFogDepthMaterial, FogOfWar, FOG_EXPLORED, isConcealed } from './fog';
import { collectGrass, GrassField } from './Grass';
import { PropsView } from './PropsView';
import { TerrainView } from './TerrainView';
import { Water } from './Water';

function installCanvasMock(): void {
  const data = new Uint8ClampedArray(512 * 512 * 4);
  const ctx: object = new Proxy(function () {}, {
    apply: () => ctx,
    get: (_target, prop) => (prop === 'data' ? data : ctx),
  });
  Object.assign(globalThis, {
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ctx,
      }),
    },
  });
}

function flat(width = 64, depth = 48): Heightfield {
  return {
    width,
    depth,
    heightAt: () => 1,
    isWater: () => false,
    isWalkable: () => true,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function wet(): Heightfield {
  return {
    width: 40,
    depth: 30,
    heightAt: (x, z) => (x > 12 && x < 24 && z > 8 && z < 18 ? -1.5 : 2),
    isWater: (x, z) => x > 12 && x < 24 && z > 8 && z < 18,
    isWalkable: () => true,
    forestDensity: () => 0,
    ground: (): GroundWeights => ({ ...GRASS_ONLY }),
  };
}

function compile(material: THREE.Material, vertexShader: string, fragmentShader: string): FogShader {
  const shader: FogShader = { uniforms: {}, vertexShader, fragmentShader };
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

interface FogShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function columnScale(root: THREE.Object3D, x: number, z: number): number | null {
  const matrix = new THREE.Matrix4();
  let found: number | null = null;
  root.traverse((obj) => {
    const mesh = obj as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const e = matrix.elements;
      if (Math.abs(e[12] - x) < 0.05 && Math.abs(e[14] - z) < 0.05) found = Math.hypot(e[0], e[1], e[2]);
    }
  });
  return found;
}

describe('FogOfWar', () => {
  it('uploads the R8 mask only when visibility.version changes', () => {
    const vis = new Visibility(16, 12);
    const fog = new FogOfWar(vis, qualityTier('low'));
    expect(fog.texture.format).toBe(THREE.RedFormat);
    expect(fog.texture.type).toBe(THREE.UnsignedByteType);
    expect(fog.texture.magFilter).toBe(THREE.LinearFilter);
    expect(fog.texture.minFilter).toBe(THREE.LinearFilter);
    expect(fog.texture.image.width).toBe(16);
    expect(fog.texture.image.height).toBe(12);
    expect(fog.cheap).toBe(true);

    // three.js uploads when texture.version changes. needsUpdate is write-only.
    const version = fog.texture.version;
    const fromVersion = fog.fromTexture.version;
    fog.update(0.05);
    expect(fog.texture.version).toBe(version + 1);
    expect(fog.fromTexture.version).toBe(fromVersion + 1);

    fog.update(0.05);
    fog.update(0.2);
    expect(fog.texture.version).toBe(version + 1);
    expect(fog.fromTexture.version).toBe(fromVersion + 1);

    vis.update([{ pos: { x: 4, z: 4 }, sight: 3 }]);
    fog.update(0.01);
    expect(fog.texture.version).toBe(version + 2);
    expect(fog.fromTexture.version).toBe(fromVersion + 2);
    const data = fog.texture.image.data as Uint8Array;
    expect(data[4 * 16 + 4]).toBe(255);
    expect(data[0]).toBe(0);
    expect((fog.fromTexture.image.data as Uint8Array)[4 * 16 + 4]).toBe(0);

    fog.update(0.2);
    expect(fog.texture.version).toBe(version + 2);
    expect(fog.fromTexture.version).toBe(fromVersion + 2);
  });

  it('fades brightness to visible, then to the explored dim, without popping', () => {
    const vis = new Visibility(20, 20);
    const fog = new FogOfWar(vis, qualityTier('high'));
    fog.update(1);
    expect(fog.brightnessAt(5, 5)).toBeCloseTo(0);

    vis.update([{ pos: { x: 5, z: 5 }, sight: 3 }]);
    fog.update(0);
    expect(fog.brightnessAt(5, 5)).toBeCloseTo(0);
    fog.update(0.2);
    const mid = fog.brightnessAt(5, 5);
    expect(mid).toBeGreaterThan(0.35);
    expect(mid).toBeLessThan(0.7);
    fog.update(0.25);
    expect(fog.brightnessAt(5, 5)).toBeCloseTo(1);

    vis.update([{ pos: { x: 15, z: 15 }, sight: 2 }]);
    fog.update(0.4);
    expect(fog.brightnessAt(5, 5)).toBeCloseTo(FOG_EXPLORED);
    expect(fog.brightnessAt(15, 15)).toBeCloseTo(1);
    expect(fog.brightnessAt(0, 0)).toBeCloseTo(0);
    expect(vis.stateAt(5, 5)).toBe(EXPLORED);
    const bytes = fog.texture.image.data as Uint8Array;
    expect(bytes[5 * 20 + 5]).toBe(Math.round(FOG_EXPLORED * 255));
    expect(bytes[15 * 20 + 15]).toBe(255);
  });
});

describe('applyFog', () => {
  const lambert = () => ({
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  });

  it('chains an existing onBeforeCompile and injects the fog mask', () => {
    const mat = new THREE.MeshLambertMaterial();
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n/* chained-vertex */',
      );
      shader.fragmentShader += '\n/* chained-fragment */';
    };
    const fog = new FogOfWar(new Visibility(8, 8), qualityTier('high'));
    applyFog(mat, fog);
    const shader = compile(mat, lambert().vertexShader, lambert().fragmentShader);

    expect(shader.vertexShader).toContain('/* chained-vertex */');
    expect(shader.vertexShader).toContain('vFogWorld');
    expect(shader.vertexShader).toContain('instanceMatrix');
    expect(shader.fragmentShader).toContain('/* chained-fragment */');
    expect(shader.fragmentShader).toContain('/* ag-fog */');
    expect(shader.fragmentShader).toContain('agFogSample');
    expect(shader.fragmentShader).toContain('uFogMap');
    expect(shader.fragmentShader).toContain('uFogFrom');
    expect(shader.fragmentShader).toContain('uFogBlend');
    expect(shader.fragmentShader).toContain('0.45');
    expect(shader.fragmentShader).toContain('agHaze');
    expect(shader.fragmentShader).toContain('uFogTime');
    expect(shader.fragmentShader).not.toContain('discard');
    expect(shader.uniforms.uFogMap).toBe(fog.uniforms.uFogMap);
    expect(shader.uniforms.uFogBlend).toBe(fog.uniforms.uFogBlend);
  });

  it('discards unexplored anchors and keeps the chain on a depth material', () => {
    const fog = new FogOfWar(new Visibility(4, 4), qualityTier('high'));
    const mat = new THREE.MeshLambertMaterial();
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader += '\n/* still-here */';
    };
    applyFog(mat, fog, { hideUnexplored: true });
    const color = compile(mat, lambert().vertexShader, lambert().fragmentShader);
    expect(color.fragmentShader).toContain('/* still-here */');
    expect(color.fragmentShader).toContain('agFogSample');
    expect(color.fragmentShader).toContain('discard');

    const depth = createFogDepthMaterial(fog);
    const packed = compile(depth, THREE.ShaderLib.depth.vertexShader, THREE.ShaderLib.depth.fragmentShader);
    expect(packed.vertexShader).toContain('instanceMatrix');
    expect(packed.fragmentShader).toContain('discard');
    expect(packed.fragmentShader).not.toContain('/* ag-fog */');
  });

  it('uses the cheap path on the low tier: same mask, no animated warp', () => {
    const fog = new FogOfWar(new Visibility(4, 4), qualityTier('low'));
    const mat = new THREE.MeshLambertMaterial();
    applyFog(mat, fog, { hideUnexplored: true });
    const shader = compile(mat, lambert().vertexShader, lambert().fragmentShader);
    expect(shader.fragmentShader).toContain('#define AG_FOG_CHEAP 1');
    expect(shader.fragmentShader).toContain('agFogSample');
    expect(shader.fragmentShader).toContain('discard');
    expect(shader.fragmentShader).not.toContain('uFogTime');
    expect(shader.fragmentShader).not.toContain('agFogNoise');
    expect(shader.uniforms.uFogTime).toBeUndefined();
  });

  it('patches the fancy water shader and the terrain splat together', () => {
    const fog = new FogOfWar(new Visibility(40, 30), qualityTier('high'));
    const water = new Water(wet(), qualityTier('high'));
    water.setFog(fog);
    const mat = water.mesh.material as THREE.ShaderMaterial;
    const shader = compile(mat, mat.vertexShader, mat.fragmentShader);
    expect(shader.vertexShader).toContain('vWorld = world.xyz;');
    expect(shader.vertexShader).toContain('vFogWorld = vWorld');
    expect(shader.fragmentShader).toContain('uTime');
    expect(shader.fragmentShader).toContain('agFogSample');
    expect(shader.fragmentShader).toContain('agHaze');

    installCanvasMock();
    const terrain = new TerrainView(flat(32, 24), qualityTier('low'));
    terrain.setFog(new FogOfWar(new Visibility(32, 24), qualityTier('low')));
    const ground = terrain.object.children[0] as THREE.Mesh;
    const splat = compile(
      ground.material as THREE.Material,
      THREE.ShaderLib.lambert.vertexShader,
      THREE.ShaderLib.lambert.fragmentShader,
    );
    expect(splat.vertexShader).toContain('vSplat0');
    expect(splat.vertexShader).toContain('vFogWorld');
    expect(splat.fragmentShader).toContain('uGrassMap');
    expect(splat.fragmentShader).toContain('agFogSample');
    expect(splat.fragmentShader).toContain('#define AG_FOG_CHEAP 1');
  });
});

describe('concealed scenery', () => {
  const weights = (over: Partial<GroundWeights> = {}): GroundWeights => ({ ...GRASS_ONLY, ...over });

  it('skips grass tufts on unexplored cells and draws them once the cell is explored', () => {
    const hf: Heightfield = {
      width: 32,
      depth: 32,
      heightAt: () => 2,
      isWater: () => false,
      isWalkable: () => true,
      forestDensity: () => 0,
      ground: () => weights(),
    };
    const quality = {
      tier: 'high' as const,
      pixelRatio: 1,
      shadows: false,
      shadowMapSize: 0,
      grassDensity: 3,
      grassRadius: 8,
      fancyWater: false,
    };
    const focus = { x: 8, z: 8 };
    const vis = new Visibility(32, 32);
    expect(collectGrass(hf, quality, focus).length).toBeGreaterThan(0);
    expect(collectGrass(hf, quality, focus, vis)).toHaveLength(0);
    expect(isConcealed(vis, focus.x, focus.z)).toBe(true);

    vis.update([{ pos: focus, sight: 3 }]);
    const shown = collectGrass(hf, quality, focus, vis);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((tuft) => vis.isExplored(tuft.x, tuft.z))).toBe(true);
    expect(shown.length).toBeLessThan(collectGrass(hf, quality, focus).length);

    const fresh = new Visibility(32, 32);
    const fog = new FogOfWar(fresh, quality);
    const grass = new GrassField(hf, quality);
    grass.setFog(fog);
    grass.update(focus, 0.2);
    let hidden = 0;
    grass.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (mesh.isInstancedMesh) hidden += mesh.count;
    });
    expect(hidden).toBe(0);

    fresh.update([{ pos: focus, sight: 30 }]);
    grass.update(focus, 1);
    let shownCount = 0;
    grass.object.traverse((obj) => {
      const mesh = obj as THREE.InstancedMesh;
      if (mesh.isInstancedMesh) shownCount += mesh.count;
    });
    expect(shownCount).toBe(collectGrass(hf, quality, focus, fresh).length);

    const mesh = grass.object.children.find((obj) => (obj as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
    const patched = compile(
      mesh.material as THREE.Material,
      THREE.ShaderLib.lambert.vertexShader,
      THREE.ShaderLib.lambert.fragmentShader,
    );
    expect(patched.vertexShader).toContain('uTime');
    expect(patched.vertexShader).toContain('vFogWorld');
    expect(patched.fragmentShader).toContain('agFogSample');
    expect(patched.fragmentShader).toContain('discard');
  });

  it('hides props on unexplored cells and restores their scale after exploring', () => {
    const hf = flat(64, 48);
    const props = [placement('house', 4, 4, 0.4, 1.25), placement('rocks', 20, 20, 0.2, 0.8)];
    const view = new PropsView(hf, props);
    const house = columnScale(view.object, 4, 4);
    const rocks = columnScale(view.object, 20, 20);
    expect(house).toBeCloseTo(1.25);
    expect(rocks).toBeCloseTo(0.8);

    const vis = new Visibility(64, 48);
    const fog = new FogOfWar(vis, qualityTier('low'));
    view.setFog(fog);
    expect(columnScale(view.object, 4, 4)).toBeCloseTo(0);
    expect(columnScale(view.object, 20, 20)).toBeCloseTo(0);

    vis.update([{ pos: { x: 4, z: 4 }, sight: 3 }]);
    fog.update(0.016);
    view.syncFog();
    expect(columnScale(view.object, 4, 4)).toBeCloseTo(1.25);
    expect(columnScale(view.object, 20, 20)).toBeCloseTo(0);
    view.dispose();
  });

  it('hides resource nodes and stumps until their cell is explored, and leaves units unfogged', () => {
    installCanvasMock();
    const hf = flat();
    const world = new World(hf, {
      townCenter: { x: 32, z: 24 },
      villagers: [{ x: 32, z: 28 }],
      scouts: [],
      nodes: [
        { kind: 'tree', pos: { x: 34, z: 26 }, amount: 40 },
        { kind: 'tree', pos: { x: 3, z: 3 }, amount: 40 },
      ],
      props: [],
    });
    const views = new EntityViews(world);
    const near = columnScale(views.object, 34, 26)!;
    const far = columnScale(views.object, 3, 3)!;
    expect(near).toBeGreaterThan(0.5);
    expect(far).toBeGreaterThan(0.5);
    expect(world.visibility.isExplored(34, 26)).toBe(true);
    expect(world.visibility.isExplored(3, 3)).toBe(false);

    const fog = new FogOfWar(world.visibility, qualityTier('medium'));
    views.setFog(fog);
    expect(columnScale(views.object, 34, 26)).toBeCloseTo(near);
    expect(columnScale(views.object, 3, 3)).toBeCloseTo(0);
    const town = views.object.children.find((obj) => obj.name === 'town-center');
    expect(town?.visible).toBe(true);

    const villager = views.object.children.find((obj) => obj.name === 'villager') as THREE.Object3D;
    let foggedUnit = false;
    villager.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).userData.agFog) foggedUnit = true;
    });
    expect(foggedUnit).toBe(false);

    const farTree = [...world.nodes.values()].find((node) => node.pos.x === 3)!;
    world.events.emit({ type: 'removed', id: farTree.id });
    const stumps = views.object.children.find((obj) => obj.name === 'stumps') as THREE.InstancedMesh;
    expect(stumps.count).toBe(1);
    expect(columnScale(stumps, 3, 3)).toBeCloseTo(0);

    world.visibility.update([{ pos: { x: 3, z: 3 }, sight: 4 }]);
    views.syncFog();
    expect(columnScale(stumps, 3, 3)).toBeCloseTo(far);
    expect(columnScale(views.object, 34, 26)).toBeCloseTo(near);
  });
});

function placement(kind: PropKind, x: number, z: number, rot = 0, scale = 1): PropPlacement {
  return { kind, pos: { x, z }, rot, scale, blockRadius: 0 };
}
