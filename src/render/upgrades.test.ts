import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { qualityTier } from '../core/quality';
import { currentSettings, initSettings, replaceSettings } from '../game/settings';
import { BUILDING_UPGRADES, BUILDINGS } from '../core/buildings';
import { CIV_IDS } from '../core/civilizations';
import type { TechId } from '../core/techs';
import type { BuildingKind } from '../core/types';
import { buildingModel, foundationModel, modelTier } from './buildings';
import { createBuildingVisual } from './buildingVisuals';
import { createUnitAvatar } from './modelBridge';
import { createSoldier, createTradeCart, createVillager } from './models';
import { applyCarryCapacity, applyUnitTiers, BASE_TIERS, buildingFortified, Shimmer, TOOL_TINT, unitTiers } from './tiers';

function meshes(object: THREE.Object3D): THREE.Mesh<THREE.BufferGeometry>[] {
  const out: THREE.Mesh<THREE.BufferGeometry>[] = [];
  object.traverse(child => { if (child instanceof THREE.Mesh) out.push(child); });
  return out;
}
const triangles = (object: THREE.Object3D): number =>
  meshes(object).reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count / 3, 0);
function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  object.traverseVisible(child => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    box.union(child.geometry.boundingBox!.clone().applyMatrix4(child.matrixWorld));
  });
  return box;
}
const colors = (object: THREE.Object3D): number[] => meshes(object).flatMap(m => Array.from(m.geometry.getAttribute('color').array));
const positions = (object: THREE.Object3D): number[] => meshes(object).flatMap(m => Array.from(m.geometry.getAttribute('position').array));
const set = (...ids: TechId[]): ReadonlySet<TechId> => new Set(ids);
/** Mean colour of a named mesh's vertices. */
function meanColor(object: THREE.Object3D, name: string): THREE.Color {
  const geometry = (object.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry>).geometry;
  const attr = geometry.getAttribute('color');
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < attr.count; i++) { r += attr.getX(i); g += attr.getY(i); b += attr.getZ(i); }
  return new THREE.Color(r / attr.count, g / attr.count, b / attr.count);
}

const civic: BuildingKind[] = ['forge', 'market', 'academy'];

describe('M8 civic building models', () => {
  it.each(civic)('%s fits its footprint, stays within 1500 triangles and is deterministic', kind => {
    const model = buildingModel(kind, { seed: 3, color: 0x204edb });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(BUILDINGS[kind].size.w, 5);
    expect(size.z).toBeCloseTo(BUILDINGS[kind].size.d, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(triangles(model)).toBeLessThanOrEqual(1500);
    expect(triangles(buildingModel(kind))).toBeLessThanOrEqual(1500);
    expect(new Set(meshes(model).map(m => m.material)).size).toBe(1);
    const again = buildingModel(kind, { seed: 3, color: 0x204edb });
    expect(colors(again)).toEqual(colors(model));
    expect(positions(again)).toEqual(positions(model));
  });

  it('gives forge, market and academy distinct silhouettes, unlike the old farm fallback', () => {
    const heights = [...civic, 'farm' as const].map(kind => bounds(buildingModel(kind)).max.y.toFixed(2));
    expect(new Set(heights).size).toBe(4);
    expect(Number(heights[2])).toBeGreaterThan(Number(heights[1]));
  });

  it('marks the forge hearth and chimney top inside the footprint for the glow and smoke', () => {
    const anchors = buildingModel('forge').userData.anchors as Record<string, [number, number, number]>;
    const { w, d } = BUILDINGS.forge.size;
    for (const [x, y, z] of [anchors.hearth, anchors.chimney]) {
      expect(Math.abs(x)).toBeLessThan(w / 2);
      expect(Math.abs(z)).toBeLessThan(d / 2);
      expect(y).toBeGreaterThan(0);
    }
    expect(anchors.chimney[1]).toBeGreaterThan(2.4);
  });

  it.each(civic)('%s reveals construction stages with its finished model last', kind => {
    const model = foundationModel(kind);
    const counts = [0, 0.3, 0.6, 0.9].map(p => { model.setProgress(p); let n = 0; model.object.traverseVisible(c => { if (c instanceof THREE.Mesh) n += c.geometry.getAttribute('position').count; }); return n; });
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(new Set(counts).size).toBe(4);
  });
});

describe('building upgrade tiers', () => {
  it('raises the watch tower through Guard and Fortress tiers within budget', () => {
    const heights = [0, 1, 2].map(tier => bounds(buildingModel('watchTower', { tier })).max.y);
    expect(heights[1]).toBeGreaterThan(heights[0] + 0.5);
    expect(heights[2]).toBeGreaterThan(heights[1]);
    for (const tier of [0, 1, 2]) {
      const model = buildingModel('watchTower', { tier, color: 0x204edb });
      expect(triangles(model)).toBeLessThanOrEqual(1500);
      expect(model.userData.tier).toBe(tier);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      expect(size.x).toBeCloseTo(BUILDINGS.watchTower.size.w, 5);
    }
    expect(positions(buildingModel('watchTower', { tier: 1 }))).not.toEqual(positions(buildingModel('watchTower', { tier: 2 })));
  });

  it('adds Fortified Town Center bastions at any tier and clamps tiers to each chain', () => {
    const base = buildingModel('townCenter');
    const fortified = buildingModel('townCenter', { fortified: true });
    expect(triangles(fortified)).toBeLessThanOrEqual(2500);
    expect(positions(fortified)).not.toEqual(positions(base));
    expect(positions(buildingModel('townCenter', { tier: 3, fortified: true })))
      .not.toEqual(positions(buildingModel('townCenter', { tier: 3 })));
    expect(modelTier('townCenter', 5)).toBe(3);
    expect(modelTier('watchTower', 9)).toBe(2);
    expect(modelTier('house', 2)).toBe(1);
    expect(modelTier('barracks', 4)).toBe(1);
    expect(modelTier('market', 2)).toBe(0);
    expect(modelTier('watchTower', NaN)).toBe(0);
    for (const kind of Object.keys(BUILDING_UPGRADES) as BuildingKind[]) expect(modelTier(kind, 99)).toBe(BUILDING_UPGRADES[kind]!.length);
  });

  it('reads the Fortified Town Center look from research, not the model tier', () => {
    expect(buildingFortified(undefined, 'townCenter')).toBe(false);
    expect(buildingFortified(set(), 'townCenter')).toBe(false);
    expect(buildingFortified(set('fortifiedTownCenter'), 'townCenter')).toBe(true);
    expect(buildingFortified(set('fortifiedTownCenter'), 'watchTower')).toBe(false);
  });

  it('gives every tier of every chain its own model for every civilisation (M14-4)', () => {
    const civs = [undefined, ...CIV_IDS];
    const hash = (values: ArrayLike<number>): string => {
      let h = 2166136261;
      for (let i = 0; i < values.length; i++) h = Math.imul(h ^ Math.round(values[i] * 1e4), 16777619);
      return (h >>> 0).toString(16) + ':' + values.length;
    };
    const visualSignatures = new Set<string>();
    for (const kind of Object.keys(BUILDING_UPGRADES) as BuildingKind[]) {
      const max = BUILDING_UPGRADES[kind]!.length;
      const heights: number[] = [];
      const geometry = new Set<string>();
      for (let tier = 0; tier <= max; tier++) {
        const tierGeometry = new Set<string>();
        for (const civ of civs) {
          const model = buildingModel(kind, { tier, civ, color: 0x204edb });
          expect(model.userData.tier).toBe(tier);
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          expect(size.x).toBeCloseTo(BUILDINGS[kind].size.w, 5);
          expect(size.z).toBeCloseTo(BUILDINGS[kind].size.d, 5);
          expect(box.min.y).toBeCloseTo(0, 5);
          expect(triangles(model)).toBeLessThanOrEqual(kind === 'townCenter' && tier > 0 ? 3000 : 2500);
          expect(meshes(model).length).toBeLessThanOrEqual(4);
          expect(new Set(meshes(model).map(m => m.material)).size).toBe(1);
          if (civ === undefined) heights.push(box.max.y);
          tierGeometry.add(hash(positions(model)));
          // The visual adds the civ's architecture tint, so even tier 0 differs per civilisation.
          const visual = createBuildingVisual(kind, 0x204edb, tier, civ);
          const finished = visual.object.getObjectByName('finished')!;
          visualSignatures.add(`${kind}:${hash([...positions(finished), ...colors(finished)])}`);
        }
        // Upgraded tiers carry a civ finial, so their geometry differs per civilisation
        // (Hellenes share theirs with models built without a civ).
        expect(tierGeometry.size).toBe(tier === 0 ? 1 : CIV_IDS.length);
        for (const sig of tierGeometry) {
          expect(geometry.has(sig)).toBe(false);
          geometry.add(sig);
        }
      }
      expect(heights[max]).toBeGreaterThanOrEqual(heights[0]);
    }
    const combos = (Object.values(BUILDING_UPGRADES) as unknown[][]).reduce((n, chain) => n + (chain.length + 1) * civs.length, 0);
    // undefined and hellenes share geometry; the hellene tint still sets them apart.
    expect(visualSignatures.size).toBe(combos);
  });

  it('builds the named silhouettes: two-storey Large House, Town Center towers, level-2 bases', () => {
    const top = (kind: BuildingKind, tier: number): number => bounds(buildingModel(kind, { tier })).max.y;
    expect(top('house', 1)).toBeGreaterThan(top('house', 0) + 1);
    expect(top('townCenter', 1)).toBeGreaterThan(top('townCenter', 0) + 0.4);
    expect(top('townCenter', 2)).toBeGreaterThan(top('townCenter', 1) + 0.4);
    expect(top('townCenter', 3)).toBeGreaterThan(top('townCenter', 2));
    expect(top('palisade', 1)).toBeGreaterThan(top('palisade', 0) + 0.3);
    expect(top('stoneWall', 1)).toBeGreaterThan(top('stoneWall', 0) + 0.3);
    for (const kind of ['barracks', 'archeryRange', 'stable'] as const) {
      expect(triangles(buildingModel(kind, { tier: 1 }))).toBeGreaterThan(triangles(buildingModel(kind)) + 100);
    }
  });

  it('cages an upgrading building in scaffolding and drops it when the tier lands (M14-4)', () => {
    const visual = createBuildingVisual('townCenter', 0x204edb, 1, 'persians');
    const root = visual.object;
    const top = bounds(root.getObjectByName('finished')!).max.y;
    expect(visual.upgrading).toBe(false);
    expect(visual.setUpgrading(null)).toBe(false);
    expect(root.getObjectByName('upgrade-scaffolding')).toBeUndefined();
    expect(visual.setUpgrading(0.2)).toBe(true);
    const scaffold = root.getObjectByName('upgrade-scaffolding') as THREE.Mesh;
    expect(scaffold.visible).toBe(true);
    expect(visual.upgrading).toBe(true);
    expect(visual.setUpgrading(0.6)).toBe(false);
    expect(root.getObjectByName('upgrade-scaffolding')).toBe(scaffold);
    const cage = bounds(scaffold);
    const { w, d } = BUILDINGS.townCenter.size;
    expect(cage.max.y).toBeGreaterThan(top);
    expect(cage.max.x).toBeLessThanOrEqual(w / 2 + 1e-4);
    expect(cage.max.z).toBeLessThanOrEqual(d / 2 + 1e-4);
    expect(cage.min.y).toBeCloseTo(0, 5);
    expect(triangles(scaffold)).toBeLessThanOrEqual(800);
    // A cancelled upgrade hides it; the finished upgrade disposes of it with the old model.
    visual.setUpgrading(null);
    expect(scaffold.visible).toBe(false);
    expect(visual.upgrading).toBe(false);
    visual.setUpgrading(0.9);
    expect(visual.setTier(2)).toBe(true);
    expect(root.getObjectByName('upgrade-scaffolding')).toBeUndefined();
    expect(visual.upgrading).toBe(false);
    // Foundations under construction never show the upgrade cage.
    const site = createBuildingVisual('house', 0x204edb);
    site.setProgress(0.4, false);
    expect(site.setUpgrading(0.5)).toBe(false);
    expect(site.object.getObjectByName('upgrade-scaffolding')).toBeUndefined();
  });

  it('swaps a building visual to its upgraded model in place', () => {
    const visual = createBuildingVisual('watchTower', 0x204edb);
    const root = visual.object;
    const before = bounds(root).max.y;
    expect(visual.tier).toBe(0);
    expect(visual.setTier(0)).toBe(false);
    expect(visual.setTier(2)).toBe(true);
    expect(visual.object).toBe(root);
    expect(visual.tier).toBe(2);
    expect(bounds(root).max.y).toBeGreaterThan(before + 1);
    expect(root.children.filter(c => c.name === 'finished')).toHaveLength(1);
    expect(root.children.filter(c => c.name === 'foundation')).toHaveLength(1);
    // A foundation keeps showing construction after the swap.
    visual.setProgress(0.4, false);
    expect(root.getObjectByName('foundation')!.visible).toBe(true);
    expect(root.getObjectByName('finished')!.visible).toBe(false);
  });

  it('gives a finished forge a hearth glow and a chimney puff', () => {
    const visual = createBuildingVisual('forge', 0x204edb);
    expect(visual.object.getObjectByName('hearth-glow')).toBeDefined();
    expect(visual.object.getObjectByName('chimney-smoke')).toBeDefined();
    expect(meshes(visual.object.getObjectByName('finished')!).length).toBeLessThanOrEqual(3);
  });
});

describe('trade cart', () => {
  it('is a grounded two-wheeled donkey cart within the unit budget, with team cloth', () => {
    const cart = createTradeCart({ color: 0x204edb, seed: 2 });
    expect(triangles(cart.object)).toBeLessThanOrEqual(900);
    expect(new Set(meshes(cart.object).map(m => m.material)).size).toBe(1);
    expect(meshes(cart.object).length).toBeLessThanOrEqual(12);
    const box = bounds(cart.object);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeLessThan(1.2);
    expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(0.1);
    expect(cart.object.getObjectByName('leftWheel')).toBeDefined();
    expect(cart.object.getObjectByName('rightWheel')).toBeDefined();
    const blue = new THREE.Color(0x204edb);
    expect(meshes(cart.object).some(m => {
      const c = m.geometry.getAttribute('color');
      for (let i = 0; i < c.count; i++) if (Math.abs(c.getZ(i) / blue.b - c.getX(i) / blue.r) < 1e-4 && c.getZ(i) > 0.7) return true;
      return false;
    })).toBe(true);
    expect(positions(createTradeCart({ color: 0xc22343, seed: 2 }).object)).toEqual(positions(cart.object));
  });

  it('rolls its wheels while walking, stays grounded and tips over when destroyed', () => {
    const cart = createTradeCart();
    const wheel = cart.object.getObjectByName('leftWheel')!;
    cart.setPose('walk', 0.2);
    const a = wheel.rotation.x;
    cart.setPose('walk', 0.6);
    expect(wheel.rotation.x).not.toBeCloseTo(a, 3);
    for (let t = 0; t <= 2; t += 0.13) {
      cart.setPose('walk', t);
      // Precise (per-vertex) bounds: a turning wheel's rotated AABB would dip below its rim.
      expect(new THREE.Box3().setFromObject(cart.object, true).min.y).toBeGreaterThanOrEqual(-0.0001);
    }
    cart.setPose('die', 0, 1);
    expect(Math.abs(cart.object.getObjectByName('soldierRig')!.rotation.z)).toBeCloseTo(Math.PI / 2, 5);
    expect(new THREE.Box3().setFromObject(cart.object, true).min.y).toBeCloseTo(0, 2);
    cart.setPose('idle', 0);
    expect(wheel.rotation.x).toBe(0);
  });

  it('mounts through the model bridge instead of the soldier fallback', () => {
    const avatar = createUnitAvatar('tradeCart', 0x204edb, 5);
    expect(avatar.object.getObjectByName('cart-load')).toBeDefined();
    expect(() => avatar.setPose('walk', 0.4)).not.toThrow();
    expect(() => avatar.setPose('die', 0.5)).not.toThrow();
  });
});

describe('unit upgrade visuals', () => {
  it('looks tiers up from the right chains', () => {
    expect(unitTiers(undefined, 'villager')).toBe(BASE_TIERS);
    expect(unitTiers(set('bronzeAxe', 'ironAxe', 'bronzePicks', 'oxPlough'), 'villager'))
      .toEqual({ wood: 2, mining: 1, farming: 1, armor: 0, line: 0 });
    expect(unitTiers(set('linenCorslet', 'bronzeScale', 'paddedJerkin'), 'hoplite').armor).toBe(2);
    expect(unitTiers(set('linenCorslet', 'paddedJerkin'), 'archer').armor).toBe(1);
    expect(unitTiers(set('linenCorslet'), 'slinger').armor).toBe(0);
    expect(unitTiers(set('horseBlankets', 'companionCavalry'), 'horseman')).toEqual({ wood: 0, mining: 0, farming: 0, armor: 1, line: 1 });
    expect(unitTiers(set('veteranHoplite', 'phalangite'), 'hoplite').line).toBe(2);
    expect(unitTiers(set('veteranSwordsman', 'heavySwordsman', 'championSwordsman'), 'swordsman').line).toBe(3);
    expect(unitTiers(set('eliteLegionary'), 'legionary').line).toBe(1);
    expect(unitTiers(set('bronzeAxe'), 'hoplite').wood).toBe(0);
  });

  it('retints villager tool heads in place without new meshes or materials', () => {
    const villager = createVillager({ seed: 1 });
    const meshCount = meshes(villager.object).length;
    const geometry = (villager.object.getObjectByName('axe') as THREE.Mesh).geometry;
    const flint = meanColor(villager.object, 'axe');
    const pos = positions(villager.object);
    applyUnitTiers(villager.object, { ...BASE_TIERS, wood: 1 });
    const bronze = meanColor(villager.object, 'axe');
    expect(bronze.r - bronze.b).toBeGreaterThan(flint.r - flint.b + 0.05);
    applyUnitTiers(villager.object, { ...BASE_TIERS, wood: 2 });
    const iron = meanColor(villager.object, 'axe');
    expect(iron.b).toBeGreaterThan(bronze.b);
    expect((villager.object.getObjectByName('axe') as THREE.Mesh).geometry).toBe(geometry);
    expect(meshes(villager.object).length).toBe(meshCount);
    expect(new Set(meshes(villager.object).map(m => m.material)).size).toBe(1);
    expect(positions(villager.object)).toEqual(pos);
    // The pick and sickle follow their own chains.
    const pick = meanColor(villager.object, 'pick');
    expect(pick.getHex()).toBe(meanColor(createVillager({ seed: 1 }).object, 'pick').getHex());
    applyUnitTiers(villager.object, BASE_TIERS);
    expect(meanColor(villager.object, 'axe').getHex()).toBe(flint.getHex());
    expect(TOOL_TINT).toHaveLength(4);
  });

  it('swings a sickle in the farm pose', () => {
    const villager = createVillager();
    villager.setPose('farm', 0.4);
    expect(villager.object.getObjectByName('sickle')!.visible).toBe(true);
    expect(villager.object.getObjectByName('axe')!.visible).toBe(false);
    expect(bounds(villager.object).min.y).toBeGreaterThanOrEqual(-0.0001);
    villager.setPose('chop', 0.4);
    expect(villager.object.getObjectByName('sickle')!.visible).toBe(false);
  });

  it('tints soldier armour by the forge chain and shows crests by unit line', () => {
    const hoplite = createSoldier('hoplite', { seed: 2 });
    const top = bounds(hoplite.object).max.y;
    const torso = meanColor(hoplite.object, 'tunic-head-armor');
    applyUnitTiers(hoplite.object, { ...BASE_TIERS, armor: 3 });
    const iron = meanColor(hoplite.object, 'tunic-head-armor');
    expect(iron.getHex()).not.toBe(torso.getHex());
    applyUnitTiers(hoplite.object, { ...BASE_TIERS, line: 1 });
    expect(bounds(hoplite.object).max.y).toBeGreaterThan(top + 0.005);
    const crests = [1, 2, 3].map((line) => {
      applyUnitTiers(hoplite.object, { ...BASE_TIERS, line });
      expect(bounds(hoplite.object).max.y).toBeGreaterThan(top + 0.005);
      return meshes(hoplite.object).map((m) => Array.from(m.geometry.getAttribute('color').array).join()).join('|');
    });
    expect(new Set(crests).size).toBe(3);
    applyUnitTiers(hoplite.object, BASE_TIERS);
    expect(bounds(hoplite.object).max.y).toBeCloseTo(top, 6);
    expect(meanColor(hoplite.object, 'tunic-head-armor').getHex()).toBe(torso.getHex());
  });

  it('adds an archer jerkin only once archer armour is researched', () => {
    const archer = createSoldier('archer', { seed: 1 });
    const before = positions(archer.object);
    applyUnitTiers(archer.object, { ...BASE_TIERS, armor: 1 });
    expect(positions(archer.object)).not.toEqual(before);
    applyUnitTiers(archer.object, BASE_TIERS);
    expect(positions(archer.object)).toEqual(before);
  });

  it('reports tier changes through the avatar and shimmers gold, then settles', () => {
    const avatar = createUnitAvatar('swordsman', 0x204edb, 3);
    expect(avatar.setTiers(BASE_TIERS)).toBe(false);
    expect(avatar.setTiers({ ...BASE_TIERS, armor: 2 })).toBe(true);
    expect(avatar.setTiers({ ...BASE_TIERS, armor: 2 })).toBe(false);
    avatar.shimmer();
    avatar.setPose('idle', 10);
    avatar.setPose('idle', 10.4);
    const mats = new Set<THREE.MeshLambertMaterial>();
    avatar.object.traverse(o => { if (o instanceof THREE.Mesh) mats.add(o.material as THREE.MeshLambertMaterial); });
    expect([...mats].some(m => m.emissive.r > 0.02)).toBe(true);
    avatar.setPose('idle', 12);
    expect([...mats].every(m => m.emissive.r === 0 && m.emissive.g === 0)).toBe(true);
  });
});

describe('shimmer and reduced motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    initSettings({ stored: null, search: '', detected: qualityTier('medium'), reducedMotion: false });
  });

  it('stays dark with the in-game setting and stops an active shimmer when it changes', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    initSettings({ stored: null, search: '', detected: qualityTier('medium'), reducedMotion: false });
    const material = new THREE.MeshLambertMaterial();
    const shimmer = new Shimmer([material]);
    shimmer.start();
    shimmer.update(1);
    shimmer.update(1.3);
    expect(material.emissive.getHex()).not.toBe(0);
    replaceSettings({ ...currentSettings(), reducedMotion: true });
    shimmer.update(1.4);
    expect(material.emissive.getHex()).toBe(0);
    shimmer.start();
    shimmer.update(2);
    shimmer.update(2.3);
    expect(material.emissive.getHex()).toBe(0);
  });

  it('increases the existing load model volume for upgraded resource capacities', () => {
    const avatar = createUnitAvatar('villager', 0x3366ff, 17);
    avatar.setPose('walk', 0, 'wood');
    const before = meshes(avatar.object);
    const wood = avatar.object.getObjectByName('carry-wood') as THREE.Mesh;
    const geometry = wood.geometry;
    applyCarryCapacity(avatar.object, { wood: 13, food: 13, gold: 13, stone: 13 }, 10);
    expect(wood.scale.x ** 3).toBeCloseTo(1.3);
    avatar.setPose('walk', 0.4, 'wood');
    expect(wood.scale.x ** 3).toBeCloseTo(1.3);
    expect(wood.geometry).toBe(geometry);
    expect(meshes(avatar.object)).toEqual(before);
    applyCarryCapacity(avatar.object, { wood: 10, food: 10, gold: 10, stone: 10 }, 10);
    expect(wood.scale.x).toBe(1);
  });

  it('stays dark when the viewer prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const material = new THREE.MeshLambertMaterial();
    const shimmer = new Shimmer([material]);
    shimmer.start();
    shimmer.update(1);
    shimmer.update(1.3);
    expect(material.emissive.getHex()).toBe(0);
  });
});
