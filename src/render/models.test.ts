import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  berryBushGeometry, createScout, createVillager, goldPileGeometry, modelMaterial, stumpGeometry, treeGeometries,
} from './models';
import type { ScoutPose, VillagerPose } from './models';

function triangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

function checkGeometry(geometry: THREE.BufferGeometry, budget: number): THREE.Vector3 {
  expect(geometry.index).toBeNull();
  expect(geometry.groups).toHaveLength(0);
  expect(triangles(geometry)).toBeGreaterThan(0);
  expect(triangles(geometry)).toBeLessThanOrEqual(budget);
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const normal = geometry.getAttribute('normal');
  for (const attribute of [position, color, normal]) {
    expect(attribute.itemSize).toBe(3);
    expect(attribute.count).toBe(position.count);
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  }
  expect(Array.from(color.array).every(value => value >= 0 && value <= 1)).toBe(true);
  for (let i = 0; i < normal.count; i += 3) {
    for (const get of [normal.getX.bind(normal), normal.getY.bind(normal), normal.getZ.bind(normal)]) {
      expect(get(i)).toBe(get(i + 1));
      expect(get(i)).toBe(get(i + 2));
    }
  }
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  expect(Math.abs(bounds.min.y)).toBeLessThanOrEqual(0.02);
  expect(Math.abs(bounds.min.x + bounds.max.x)).toBeLessThan(0.02);
  expect(Math.abs(bounds.min.z + bounds.max.z)).toBeLessThan(0.02);
  return bounds.getSize(new THREE.Vector3());
}

function hasColor(geometry: THREE.BufferGeometry, hex: number): boolean {
  const expected = new THREE.Color(hex);
  const colors = geometry.getAttribute('color');
  for (let i = 0; i < colors.count; i++) {
    if (matchesShade(colors, i, expected)) return true;
  }
  return false;
}

function matchesShade(colors: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, expected: THREE.Color): boolean {
  const source = [expected.r, expected.g, expected.b];
  const actual = [colors.getX(i), colors.getY(i), colors.getZ(i)];
  const dominant = source.indexOf(Math.max(...source));
  const shade = source[dominant] === 0 ? 1 : actual[dominant] / source[dominant];
  return shade >= 0.85 && shade <= 1.15 && actual.every((value, channel) => Math.abs(value - source[channel] * shade) < 1e-6);
}

function colorVisibleFrom(geometry: THREE.BufferGeometry, hex: number, eye: THREE.Vector3): boolean {
  const material = modelMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const ray = new THREE.Raycaster();
  const position = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  const expected = new THREE.Color(hex);
  const point = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  let visible = false;
  for (let i = 0; i < position.count; i += 3) {
    if (!matchesShade(colors, i, expected)) continue;
    point.set(0, 0, 0);
    for (let j = 0; j < 3; j++) point.add(vertex.fromBufferAttribute(position, i + j));
    point.divideScalar(3);
    ray.set(eye, point.sub(eye).normalize());
    if (ray.intersectObject(mesh)[0]?.faceIndex === i / 3) {
      visible = true;
      break;
    }
  }
  material.dispose();
  return visible;
}

function visibleBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  object.traverseVisible(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!.clone().applyMatrix4(child.matrixWorld));
  });
  return bounds;
}

function transforms(object: THREE.Object3D): number[] {
  const values: number[] = [];
  object.traverse(child => {
    values.push(...child.position.toArray(), ...child.quaternion.toArray(), ...child.scale.toArray(), Number(child.visible));
  });
  return values;
}

describe('static models', () => {
  it('provides distinct, deterministic tree silhouettes within the scale and triangle limits', () => {
    const trees = treeGeometries();
    const repeated = treeGeometries();
    expect(trees.length).toBeGreaterThanOrEqual(6);
    expect(trees.map(tree => tree.name)).toEqual(expect.arrayContaining(['tree-broadleaf', 'tree-pine', 'tree-cypress', 'tree-olive', 'tree-stone-pine']));
    const signatures = new Set<string>();
    trees.forEach((geometry, i) => {
      const size = checkGeometry(geometry, 260);
      expect(size.y).toBeGreaterThanOrEqual(2.6);
      expect(size.y).toBeLessThanOrEqual(4.2);
      expect(size.x / 2).toBeGreaterThanOrEqual(0.3);
      expect(size.x / 2).toBeLessThanOrEqual(1.7);
      expect(size.z / 2).toBeGreaterThanOrEqual(0.3);
      expect(size.z / 2).toBeLessThanOrEqual(1.7);
      if (geometry.name === 'tree-cypress') expect(size.y / size.x).toBeGreaterThan(4);
      if (geometry.name === 'tree-stone-pine') expect(size.x).toBeGreaterThan(2.5);
      const positions = Array.from(geometry.getAttribute('position').array);
      expect(positions).toEqual(Array.from(repeated[i].getAttribute('position').array));
      expect(Array.from(geometry.getAttribute('color').array)).toEqual(Array.from(repeated[i].getAttribute('color').array));
      expect(new Set(Array.from(geometry.getAttribute('color').array)).size).toBeGreaterThan(30);
      expect(geometry).not.toBe(repeated[i]);
      signatures.add(JSON.stringify(positions));
    });
    expect(signatures.size).toBe(trees.length);
  });

  it('grounds a small stump with a contrasting cut surface', () => {
    const geometry = stumpGeometry();
    const size = checkGeometry(geometry, 120);
    expect(size.y).toBeGreaterThanOrEqual(0.28);
    expect(size.y).toBeLessThanOrEqual(0.4);
    expect(hasColor(geometry, 0xc4956a)).toBe(true);
  });

  it('keeps the berry bush near 0.8 m with visible red berry geometry', () => {
    const geometry = berryBushGeometry();
    const size = checkGeometry(geometry, 220);
    expect(size.y).toBeGreaterThanOrEqual(0.72);
    expect(size.y).toBeLessThanOrEqual(0.88);
    expect(hasColor(geometry, 0xc74432)).toBe(true);
    expect(hasColor(geometry, 0x9e3b26)).toBe(true);
  });

  it('keeps the gold outcrop near 0.7 m tall and 1.2 m wide with grey and gold faces', () => {
    const geometry = goldPileGeometry();
    const size = checkGeometry(geometry, 220);
    expect(size.y).toBeGreaterThanOrEqual(0.6);
    expect(size.y).toBeLessThanOrEqual(0.8);
    expect(size.x).toBeGreaterThanOrEqual(1.05);
    expect(size.x).toBeLessThanOrEqual(1.35);
    expect(hasColor(geometry, 0x888579)).toBe(true);
    expect(hasColor(geometry, 0xd4a843)).toBe(true);
  });

  it('supplies a reusable flat-shaded Lambert material without textures', () => {
    const material = modelMaterial();
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material.vertexColors).toBe(true);
    expect(material.flatShading).toBe(true);
    expect(material.map).toBeNull();
    const tree = treeGeometries()[0];
    const instances = new THREE.InstancedMesh(tree, material, 400);
    expect(instances.count).toBe(400);
    expect(instances.geometry.getAttribute('color').count).toBe(tree.getAttribute('position').count);
  });

  it('exposes berry and gold faces from an eye-level camera without foliage or rock occlusion', () => {
    const front = new THREE.Vector3(0, 1.6, 3);
    const back = new THREE.Vector3(0, 1.6, -3);
    const bush = berryBushGeometry();
    expect(colorVisibleFrom(bush, 0xc74432, front)).toBe(true);
    expect(colorVisibleFrom(bush, 0xc74432, back)).toBe(true);
    const gold = goldPileGeometry();
    expect(colorVisibleFrom(gold, 0xd4a843, front)).toBe(true);
    expect(colorVisibleFrom(gold, 0x888579, front)).toBe(true);
  });
});

describe('villager', () => {
  const poses: VillagerPose[] = ['idle', 'walk', 'chop', 'forage', 'mine'];
  const carries = [undefined, null, 'wood', 'food', 'gold'] as const;

  it.each([0, 1, 2])('stands near 0.95 m facing +z with dress variant %s under 600 triangles including hidden goods', seed => {
    const model = createVillager({ seed });
    const bounds = new THREE.Box3().setFromObject(model.object);
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.y).toBeGreaterThan(0.92);
    expect(bounds.max.y).toBeLessThan(1.01);
    expect(Math.abs(bounds.getCenter(new THREE.Vector3()).x)).toBeLessThan(0.12);
    expect(Math.abs(bounds.getCenter(new THREE.Vector3()).z)).toBeLessThan(0.12);
    expect(model.object.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    let total = 0;
    const materials = new Set<THREE.Material>();
    model.object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      total += triangles(child.geometry);
      expect(child.geometry.getAttribute('color')).toBeDefined();
      expect(child.geometry.getAttribute('normal')).toBeDefined();
      expect(child.geometry.index).toBeNull();
      materials.add(child.material as THREE.Material);
    });
    expect(total).toBeLessThanOrEqual(600);
    expect(materials.size).toBe(1);
  });

  it.each(poses)('poses %s with every carried resource, keeping finite transforms and grounded feet', pose => {
    for (const seed of [0, 1, 2]) {
      const model = createVillager({ seed });
      for (const carry of carries) {
        for (const time of [0, 0.125, 0.5, 1, 4, 25.25]) {
          expect(() => model.setPose(pose, time, carry)).not.toThrow();
          expect(transforms(model.object).every(Number.isFinite)).toBe(true);
          const bounds = visibleBounds(model.object);
          expect(bounds.min.y).toBeGreaterThanOrEqual(-0.0001);
          expect(bounds.min.y).toBeLessThanOrEqual(0.021);
          expect(model.object.getObjectByName('axe')!.visible).toBe(pose === 'chop');
          expect(model.object.getObjectByName('pick')!.visible).toBe(pose === 'mine');
          for (const resource of ['wood', 'food', 'gold']) {
            expect(model.object.getObjectByName(`carry-${resource}`)!.visible).toBe(carry === resource);
          }
        }
      }
    }
  });

  it('moves opposing legs and arms while walking and bobs the rig', () => {
    const model = createVillager();
    const swings: number[] = [];
    const heights: number[] = [];
    for (const time of [0, 0.1, 0.2, 0.3]) {
      model.setPose('walk', time);
      const left = model.object.getObjectByName('leftLeg')!;
      const right = model.object.getObjectByName('rightLeg')!;
      swings.push(left.rotation.x);
      heights.push(model.object.getObjectByName('rig')!.position.y);
      expect(left.rotation.x).toBeCloseTo(-right.rotation.x);
      expect(model.object.getObjectByName('leftArm')!.rotation.x).toBeCloseTo(-model.object.getObjectByName('rightArm')!.rotation.x);
    }
    expect(Math.max(...swings) - Math.min(...swings)).toBeGreaterThan(0.3);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.005);
  });

  it.each([
    ['idle', 2.5], ['walk', 0.625], ['chop', 0.8], ['forage', 1], ['mine', 0.8],
  ] as const)('loops %s smoothly without accumulating pose changes', (pose, period) => {
    const model = createVillager({ seed: 19 });
    model.setPose(pose, 0.173, 'food');
    const start = transforms(model.object);
    model.setPose(pose, 0.173 + period, 'food');
    transforms(model.object).forEach((value, i) => expect(value).toBeCloseTo(start[i], 6));
    model.setPose('idle', 0);
    const fresh = createVillager({ seed: 19 });
    expect(transforms(model.object)).toEqual(transforms(fresh.object));
  });

  it('preserves the renderer-owned world transform and applies custom colours including black', () => {
    const model = createVillager({ tunic: 0, skin: 0xd4a843, seed: 4 });
    model.object.position.set(13, 2, 9);
    model.object.rotation.y = 1.2;
    model.object.scale.setScalar(1.1);
    for (const pose of poses) model.setPose(pose, 3.4, 'gold');
    expect(model.object.position.toArray()).toEqual([13, 2, 9]);
    expect(model.object.rotation.y).toBe(1.2);
    expect(model.object.scale.toArray()).toEqual([1.1, 1.1, 1.1]);
    const torso = model.object.getObjectByName('torso-head') as THREE.Mesh<THREE.BufferGeometry>;
    expect(hasColor(torso.geometry, 0)).toBe(true);
    expect(hasColor(torso.geometry, 0xd4a843)).toBe(true);
  });
});

describe('mounted scout', () => {
  const poses: ScoutPose[] = ['idle', 'walk', 'gallop'];
  const legNames = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

  it.each([0, 1, 2, 3, 4, 5])('grounds and centres seed %s at cavalry scale within 1400 flat-shaded triangles', seed => {
    const model = createScout({ seed });
    const bounds = visibleBounds(model.object);
    const size = bounds.getSize(new THREE.Vector3());
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.y).toBeGreaterThan(1.8);
    expect(bounds.max.y).toBeLessThan(2.05);
    expect(size.z).toBeGreaterThan(1.7);
    expect(size.z).toBeLessThan(2.1);
    expect(size.x).toBeGreaterThan(0.5);
    expect(size.x).toBeLessThan(0.8);
    expect(Math.abs(bounds.getCenter(new THREE.Vector3()).x)).toBeLessThan(0.08);
    expect(Math.abs(bounds.getCenter(new THREE.Vector3()).z)).toBeLessThan(0.12);
    const body = model.object.getObjectByName('horse-body-tack') as THREE.Mesh<THREE.BufferGeometry>;
    const withers = new THREE.Box3();
    const coat = new THREE.Color([0x985032, 0x65402b, 0xb1b0a6][seed % 3]);
    const positions = body.geometry.getAttribute('position');
    const colors = body.geometry.getAttribute('color');
    for (let i = 0; i < positions.count; i++) {
      if (matchesShade(colors, i, coat)) withers.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(body.matrixWorld));
    }
    expect(withers.max.y).toBeGreaterThan(1.2);
    expect(withers.max.y).toBeLessThan(1.32);
    let total = 0;
    let meshes = 0;
    const materials = new Set<THREE.Material>();
    model.object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      meshes++;
      const geometry = child.geometry as THREE.BufferGeometry;
      total += triangles(geometry);
      expect(geometry.index).toBeNull();
      expect(geometry.groups).toHaveLength(0);
      const position = geometry.getAttribute('position');
      const color = geometry.getAttribute('color');
      const normal = geometry.getAttribute('normal');
      for (const attribute of [position, color, normal]) {
        expect(attribute.itemSize).toBe(3);
        expect(attribute.count).toBe(position.count);
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      expect(Array.from(color.array).every(value => value >= 0 && value <= 1)).toBe(true);
      for (let i = 0; i < normal.count; i += 3) {
        expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([normal.getX(i + 1), normal.getY(i + 1), normal.getZ(i + 1)]);
        expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual([normal.getX(i + 2), normal.getY(i + 2), normal.getZ(i + 2)]);
      }
      materials.add(child.material as THREE.Material);
    });
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(1400);
    expect(meshes).toBeLessThanOrEqual(16);
    expect(materials.size).toBe(1);
    const material = [...materials][0] as THREE.MeshLambertMaterial;
    expect(material.vertexColors).toBe(true);
    expect(material.flatShading).toBe(true);
    expect(material.map).toBeNull();
  });

  it('faces +z with the muzzle ahead of the neck and the tail behind the rider', () => {
    const model = createScout({ seed: 0 });
    const head = visibleBounds(model.object.getObjectByName('horse-head-bridle')!);
    const neck = visibleBounds(model.object.getObjectByName('horse-neck')!);
    const tail = visibleBounds(model.object.getObjectByName('horse-tail')!);
    const rider = visibleBounds(model.object.getObjectByName('rider-tunic-head')!);
    expect(head.max.z).toBeGreaterThan(0.9);
    expect(head.getCenter(new THREE.Vector3()).z).toBeGreaterThan(neck.getCenter(new THREE.Vector3()).z);
    expect(tail.max.z).toBeLessThan(rider.min.z);
    expect(model.object.position.toArray()).toEqual([0, 0, 0]);
    expect(model.object.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it.each(poses)('animates all four legs in %s without ground penetration or nonfinite transforms', pose => {
    for (const seed of [0, 1, 2]) {
      const model = createScout({ seed });
      const swings = legNames.map(() => [] as number[]);
      const knees = legNames.map(() => [] as number[]);
      for (let step = 0; step <= 24; step++) {
        const time = step / 12;
        expect(() => model.setPose(pose, time)).not.toThrow();
        expect(transforms(model.object).every(Number.isFinite)).toBe(true);
        const bounds = visibleBounds(model.object);
        expect(bounds.min.y).toBeGreaterThanOrEqual(-0.00001);
        expect(bounds.min.y).toBeLessThanOrEqual(pose === 'gallop' ? 0.061 : 0.00001);
        legNames.forEach((name, i) => {
          swings[i].push(model.object.getObjectByName(`${name}Leg`)!.rotation.x);
          knees[i].push(model.object.getObjectByName(`${name}Knee`)!.rotation.x);
        });
      }
      for (const samples of swings) expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(pose === 'idle' ? 0.015 : 0.4);
      for (const samples of knees) expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(pose === 'idle' ? 0.01 : 0.15);
    }
  });

  it('walks with four distinct footfall phases instead of a diagonal trot', () => {
    const model = createScout();
    const traces = legNames.map(() => [] as number[]);
    const peaks: number[] = [];
    for (let step = 0; step < 40; step++) {
      model.setPose('walk', step / 56);
      legNames.forEach((name, i) => traces[i].push(model.object.getObjectByName(`${name}Knee`)!.rotation.x));
    }
    for (const trace of traces) peaks.push(trace.indexOf(Math.max(...trace)));
    peaks.sort((a, b) => a - b);
    const gaps = peaks.map((peak, i) => (peaks[(i + 1) % 4] - peak + 40) % 40);
    expect(gaps).toEqual([10, 10, 10, 10]);
  });

  it('gallops faster than walking and animates body pitch, rider, mane and tail', () => {
    const model = createScout({ seed: 7 });
    const sample = (pose: ScoutPose): { leg: number[]; body: number[]; rider: number[]; mane: number[]; tail: number[]; height: number[] } => {
      const values = { leg: [] as number[], body: [] as number[], rider: [] as number[], mane: [] as number[], tail: [] as number[], height: [] as number[] };
      for (let step = 0; step < 100; step++) {
        model.setPose(pose, step / 100);
        values.leg.push(model.object.getObjectByName('frontLeftLeg')!.rotation.x);
        values.body.push(model.object.getObjectByName('horse')!.rotation.x);
        values.rider.push(model.object.getObjectByName('rider')!.position.y);
        values.mane.push(model.object.getObjectByName('horseMane')!.rotation.x);
        values.tail.push(model.object.getObjectByName('horseTail')!.rotation.x);
        values.height.push(model.object.getObjectByName('rig')!.position.y);
      }
      return values;
    };
    const walk = sample('walk');
    const gallop = sample('gallop');
    const crossings = (trace: number[]): number => trace.slice(1).filter((value, i) => value * trace[i] < 0).length;
    expect(crossings(gallop.leg)).toBeGreaterThan(crossings(walk.leg));
    for (const trace of [gallop.body, gallop.rider, gallop.mane, gallop.tail, gallop.height]) {
      expect(Math.max(...trace) - Math.min(...trace)).toBeGreaterThan(0.025);
    }
    const idle = sample('idle');
    expect(Math.max(...idle.tail) - Math.min(...idle.tail)).toBeGreaterThan(0.01);
  });

  it.each([
    ['idle', 4], ['walk', 1 / 1.4], ['gallop', 1 / 2.8],
  ] as const)('loops %s smoothly and resets after other orders', (pose, period) => {
    const model = createScout({ seed: 19 });
    model.setPose(pose, 0.173);
    const start = transforms(model.object);
    model.setPose(pose, 0.173 + period);
    transforms(model.object).forEach((value, i) => expect(value).toBeCloseTo(start[i], 6));
    model.setPose(pose, period - 0.00001);
    const beforeWrap = transforms(model.object);
    model.setPose(pose, period + 0.00001);
    transforms(model.object).forEach((value, i) => expect(Math.abs(value - beforeWrap[i])).toBeLessThan(0.001));
    for (const other of poses) model.setPose(other, 17.8);
    model.setPose('idle', 0);
    expect(transforms(model.object)).toEqual(transforms(createScout({ seed: 19 }).object));
  });

  it('deterministically varies horse coats and headgear by seed', () => {
    const signatures = (seed: number, name: string, attribute: string): number[] => {
      const mesh = createScout({ seed }).object.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry>;
      return Array.from(mesh.geometry.getAttribute(attribute).array);
    };
    const coats = [0, 1, 2].map(seed => signatures(seed, 'horse-body-tack', 'color'));
    expect(new Set(coats.map(colors => JSON.stringify(colors))).size).toBe(3);
    expect(signatures(0, 'rider-tunic-head', 'position')).not.toEqual(signatures(1, 'rider-tunic-head', 'position'));
    for (const name of ['horse-body-tack', 'rider-tunic-head']) {
      for (const attribute of ['position', 'color']) {
        expect(signatures(7, name, attribute)).toEqual(signatures(7, name, attribute));
      }
    }
    expect(transforms(createScout({ seed: 7 }).object)).toEqual(transforms(createScout({ seed: 7 }).object));
  });

  it('uses the player colour for both cloths, accepts black, and preserves the world transform', () => {
    for (const color of [0, 0x446b81]) {
      const model = createScout({ cloak: color, seed: 2 });
      model.object.position.set(13, 2, 9);
      model.object.rotation.set(0.1, 1.2, -0.2);
      model.object.scale.setScalar(1.1);
      const original = [...model.object.position.toArray(), ...model.object.quaternion.toArray(), ...model.object.scale.toArray()];
      for (const pose of poses) model.setPose(pose, 3.4);
      expect([...model.object.position.toArray(), ...model.object.quaternion.toArray(), ...model.object.scale.toArray()]).toEqual(original);
      for (const name of ['horse-body-tack', 'rider-cloak']) {
        const mesh = model.object.getObjectByName(name) as THREE.Mesh<THREE.BufferGeometry>;
        expect(hasColor(mesh.geometry, color)).toBe(true);
      }
    }
  });
});
