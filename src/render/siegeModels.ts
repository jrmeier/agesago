import * as THREE from 'three';
import { UNITS } from '../core/units';
import { merge, modelMaterial, part, seededRandom, type SoldierPose, type Triple } from './models';

/**
 * Code-built siege engines (M16-3), facing +z with wheels seated at y = 0.
 * One shared vertex-colour material per engine and a handful of pivots; `setPose` only moves
 * pivots, so there is no geometry work per frame.
 *
 * Besides the usual pose and clock, an engine reads two numbers from the renderer:
 * - `deploy` 0..1: packed for travel (0) through setting up to ready to shoot (1).
 * - `sinceFire`: seconds since its last shot or ram blow, so the throw lands on the sim's attack.
 */

export type SiegeKind = 'ram' | 'catapult' | 'boltShooter';

export interface SiegePoseExtra {
  /** Die: fall progress 0..1. */
  progress?: number;
  /** 0 packed .. 1 set up (engines that do not pack ignore it). */
  deploy?: number;
  /** Seconds since the engine last fired or struck; absent or Infinity when it has not. */
  sinceFire?: number;
}

export interface SiegeModel {
  object: THREE.Group;
  setPose(pose: SoldierPose, t: number, extra?: SiegePoseExtra | number): void;
}

export function isSiegeKind(kind: string): kind is SiegeKind {
  return kind === 'ram' || kind === 'catapult' || kind === 'boltShooter';
}

const WOOD = 0x82603b;
const DARK_WOOD = 0x5e4129;
const ROPE = 0xc9b48a;
const BRONZE = 0xb08a3e;
const IRON = 0x6f7378;
const HIDE = 0x8a6a4a;

/** Catapult arm angles about x (0 = straight up; negative leans back over the frame). */
export const ARM_STOWED = 1.35;
export const ARM_COCKED = -1.3;
export const ARM_THROWN = 0.4;
/** Seconds the catapult arm takes to swing up after the shot leaves. */
export const THROW_SECONDS = 0.16;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number): number => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * Catapult arm angle for a set-up engine, `sinceFire` seconds after its last shot.
 * Swings from cocked to thrown in {@link THROW_SECONDS}, holds against the crossbar, then the
 * crew winches it back and it is cocked again well before the next shot (`reload` seconds).
 */
export function catapultArm(sinceFire: number, reload: number): number {
  if (!(sinceFire >= 0) || !Number.isFinite(sinceFire)) return ARM_COCKED;
  if (sinceFire < THROW_SECONDS) return lerp(ARM_COCKED, ARM_THROWN, smooth(sinceFire / THROW_SECONDS));
  const hold = THROW_SECONDS + 0.45;
  if (sinceFire < hold) return ARM_THROWN - Math.sin(((sinceFire - THROW_SECONDS) / 0.45) * Math.PI) * 0.06;
  const wind = Math.max(0.5, reload * 0.7 - hold);
  return lerp(ARM_THROWN, ARM_COCKED, smooth((sinceFire - hold) / wind));
}

/**
 * Ram beam swing, forward (+) at each blow: a pendulum whose period is the reload, so it is
 * fully forward the moment the sim lands a hit and pulled back halfway between hits.
 * Settles at rest once blows stop.
 */
export function ramSwing(sinceFire: number, reload: number): number {
  if (!(sinceFire >= 0) || !Number.isFinite(sinceFire)) return 0;
  const fade = 1 - smooth((sinceFire - reload * 1.1) / (reload * 0.6));
  return Math.cos((sinceFire / reload) * Math.PI * 2) * fade;
}

/**
 * Bolt shooter string draw: 1 drawn back to the trigger, 0 released. Snaps forward at the shot,
 * quivers briefly, then the winch draws it again before the next shot.
 */
export function boltDraw(sinceFire: number, reload: number): number {
  if (!(sinceFire >= 0) || !Number.isFinite(sinceFire)) return 1;
  if (sinceFire < 0.06) return 1 - sinceFire / 0.06;
  const rest = 0.45;
  if (sinceFire < rest) return Math.sin((sinceFire - 0.06) * 60) * 0.12 * (1 - (sinceFire - 0.06) / (rest - 0.06));
  return smooth((sinceFire - rest) / Math.max(0.4, reload * 0.6 - rest));
}

function rod(hex: number, from: Triple, to: Triple, radius: number, sides = 5): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const direction = b.clone().sub(a);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), sides);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  return part(geometry, hex, a.add(b).multiplyScalar(0.5).toArray() as Triple);
}

function box(size: Triple, hex: number, pos: Triple, rotation: Triple = [0, 0, 0]): THREE.BufferGeometry {
  return part(new THREE.BoxGeometry(...size), hex, pos, [1, 1, 1], rotation);
}

function wheelGeometry(radius: number, width: number): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(radius, radius, width, 10), WOOD, [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, width * 0.5, 10), IRON, [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    part(new THREE.CylinderGeometry(radius * 0.25, radius * 0.25, width * 1.6, 6), DARK_WOOD, [0, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]),
    box([width * 1.1, radius * 1.8, radius * 0.2], DARK_WOOD, [0, 0, 0]),
    box([width * 1.1, radius * 0.2, radius * 1.8], DARK_WOOD, [0, 0, 0]),
  ]);
}

interface Builder {
  object: THREE.Group;
  rig: THREE.Group;
  material: THREE.MeshLambertMaterial;
  pivot(parent: THREE.Object3D, name: string, pos: Triple): THREE.Group;
  mesh(pieces: THREE.BufferGeometry[] | THREE.BufferGeometry, parent: THREE.Object3D, name: string): THREE.Mesh;
  wheels(radius: number, width: number, spots: Array<[number, number]>): THREE.Group[];
}

function builder(kind: SiegeKind): Builder {
  const material = modelMaterial();
  const object = new THREE.Group();
  object.name = kind;
  const rig = new THREE.Group();
  rig.name = 'soldierRig';
  object.add(rig);
  const b: Builder = {
    object, rig, material,
    pivot(parent, name, pos) {
      const group = new THREE.Group();
      group.name = name;
      group.position.set(...pos);
      parent.add(group);
      return group;
    },
    mesh(pieces, parent, name) {
      const result = new THREE.Mesh(Array.isArray(pieces) ? merge(pieces) : pieces, material);
      result.name = name;
      result.castShadow = result.receiveShadow = true;
      parent.add(result);
      return result;
    },
    wheels(radius, width, spots) {
      const geometry = wheelGeometry(radius, width);
      return spots.map(([x, z], i) => {
        const wheel = b.pivot(rig, `wheel${i}`, [x, radius, z]);
        b.mesh(geometry, wheel, 'wheel');
        return wheel;
      });
    },
  };
  return b;
}

/** Roll wheels for travel at about 1.1 m/s of model speed. */
function roll(wheels: THREE.Group[], radius: number, walking: boolean, time: number): void {
  const angle = walking ? (time * 1.1) / radius : 0;
  for (const wheel of wheels) wheel.rotation.set(angle, 0, 0);
}

/** A wrecked engine slumps onto one side; corpses fade out in DeathGhosts. */
function collapse(rig: THREE.Group, progress: number): void {
  const p = smooth(progress);
  rig.rotation.set(-p * 0.12, 0, p * 0.42);
  rig.position.set(0, -p * 0.12, 0);
}

function extraOf(extra: SiegePoseExtra | number | undefined): SiegePoseExtra {
  return typeof extra === 'number' ? { progress: extra } : extra ?? {};
}

/** Covered battering ram: a hide roof on a four-wheeled frame, beam slung from the ridge. */
function createRam(color: number, seed: number): SiegeModel {
  const b = builder('ram');
  const random = seededRandom(seed + 811);
  const hide = [HIDE, 0x7c5f43, 0x96754f][seed % 3];
  const frame: THREE.BufferGeometry[] = [];
  // Chassis rails, cross beams and corner posts.
  for (const side of [-1, 1]) {
    frame.push(box([0.07, 0.08, 1.5], DARK_WOOD, [side * 0.36, 0.3, 0]));
    for (const z of [-0.62, 0, 0.62]) frame.push(box([0.06, 0.62, 0.06], WOOD, [side * 0.36, 0.64, z]));
    frame.push(box([0.06, 0.06, 1.4], WOOD, [side * 0.36, 0.94, 0]));
  }
  for (const z of [-0.62, 0.62]) frame.push(box([0.78, 0.07, 0.07], DARK_WOOD, [0, 0.3, z]));
  // Pitched hide roof with a team-coloured hide stripe and a ridge pole.
  const pitch = 0.62;
  for (const side of [-1, 1]) {
    frame.push(box([0.5, 0.05, 1.56], hide, [side * 0.21, 1.1, 0], [0, 0, -side * pitch]));
    frame.push(box([0.06, 0.055, 1.5], color, [side * 0.33, 1.02, 0], [0, 0, -side * pitch]));
    for (const z of [-0.5, -0.1, 0.3]) {
      const lap = 0.03 + random() * 0.02;
      frame.push(box([0.48, 0.02, lap], 0x5c4632, [side * 0.21, 1.13, z], [0, 0, -side * pitch]));
    }
  }
  frame.push(box([0.07, 0.07, 1.6], DARK_WOOD, [0, 1.26, 0]));
  // Gable end boards so the shed reads from the front.
  frame.push(box([0.55, 0.22, 0.04], WOOD, [0, 1.06, -0.76]));
  b.mesh(frame, b.rig, 'ram-shed');
  // Beam on two ropes from the ridge, with a bronze ram's head poking out front.
  const beam = b.pivot(b.rig, 'ram-beam', [0, 0.62, 0]);
  b.mesh([
    rod(DARK_WOOD, [0, 0, -0.8], [0, 0, 0.72], 0.075, 7),
    part(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 7), BRONZE, [0, 0, 0.8], [1, 1, 1], [Math.PI / 2, 0, 0]),
    part(new THREE.ConeGeometry(0.1, 0.16, 7), BRONZE, [0, 0, 0.97], [1, 1, 1], [Math.PI / 2, 0, 0]),
    ...[-1, 1].map(side => part(new THREE.TorusGeometry(0.06, 0.018, 4, 6, Math.PI), BRONZE,
      [side * 0.09, 0.05, 0.84], [1, 1, 1], [0, Math.PI / 2, 0])),
    box([0.17, 0.035, 0.035], IRON, [0, 0, 0.34]),
    box([0.17, 0.035, 0.035], IRON, [0, 0, -0.36]),
    // Slings, carried with the beam so they swing together.
    rod(ROPE, [0, 0.07, 0.34], [0, 0.62, 0.34], 0.012, 4),
    rod(ROPE, [0, 0.07, -0.36], [0, 0.62, -0.36], 0.012, 4),
  ], beam, 'ram-beam');
  const wheels = b.wheels(0.2, 0.08, [[-0.44, 0.48], [0.44, 0.48], [-0.44, -0.48], [0.44, -0.48]]);
  const reload = UNITS.ram.reload;
  return {
    object: b.object,
    setPose(pose, t, raw) {
      const extra = extraOf(raw);
      const time = Number.isFinite(t) ? t : 0;
      b.rig.rotation.set(0, 0, 0);
      b.rig.position.set(0, 0, 0);
      roll(wheels, 0.2, pose === 'walk', time);
      // A pendulum hung at the ridge: forward travel also lifts the head a little.
      const swing = pose === 'attack' ? ramSwing(extra.sinceFire ?? Infinity, reload) : 0;
      const angle = swing * 0.42;
      beam.rotation.set(0, 0, 0);
      beam.position.set(0, 0.62 + (1 - Math.cos(angle)) * 0.62, Math.sin(angle) * 0.62);
      if (pose === 'die') collapse(b.rig, extra.progress ?? 0);
    },
  };
}

/** Torsion catapult (onager): heavy frame, skein-sprung arm and a padded crossbar. */
function createCatapult(color: number, seed: number): SiegeModel {
  const b = builder('catapult');
  const wood = [WOOD, 0x8a6740, 0x7a5835][seed % 3];
  const frame: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    frame.push(box([0.09, 0.1, 1.3], wood, [side * 0.3, 0.3, -0.05]));
    // Uprights and braces for the crossbar the arm stops against.
    frame.push(box([0.07, 0.62, 0.08], wood, [side * 0.3, 0.62, 0.3]));
    frame.push(rod(DARK_WOOD, [side * 0.3, 0.34, 0.55], [side * 0.3, 0.85, 0.32], 0.03));
    // Torsion skein housings either side of the arm pivot.
    frame.push(part(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), BRONZE, [side * 0.22, 0.38, -0.05], [1, 1, 1], [0, 0, Math.PI / 2]));
  }
  for (const z of [-0.65, -0.05, 0.5]) frame.push(box([0.68, 0.08, 0.08], DARK_WOOD, [0, 0.3, z]));
  frame.push(part(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8), ROPE, [0, 0.38, -0.05], [1, 1, 1], [0, 0, Math.PI / 2]));
  // Padded crossbar in team colour, and the winch drum at the back.
  frame.push(box([0.66, 0.1, 0.1], DARK_WOOD, [0, 0.92, 0.3]));
  frame.push(box([0.4, 0.13, 0.13], color, [0, 0.92, 0.25]));
  frame.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 6), DARK_WOOD, [0, 0.42, -0.62], [1, 1, 1], [0, 0, Math.PI / 2]));
  for (const side of [-1, 1]) frame.push(box([0.03, 0.18, 0.03], WOOD, [side * 0.2, 0.42, -0.62], [0.6, 0, 0]));
  b.mesh(frame, b.rig, 'catapult-frame');
  // Arm grows along +y from the skein; cup and stone at the tip.
  const arm = b.pivot(b.rig, 'catapult-arm', [0, 0.38, -0.05]);
  b.mesh([
    box([0.08, 0.86, 0.08], DARK_WOOD, [0, 0.43, 0]),
    box([0.1, 0.04, 0.1], IRON, [0, 0.2, 0]),
    part(new THREE.CylinderGeometry(0.12, 0.07, 0.08, 7), WOOD, [0, 0.88, 0.04], [1, 1, 1], [Math.PI / 2, 0, 0]),
  ], arm, 'catapult-arm');
  const stone = b.mesh([part(new THREE.DodecahedronGeometry(0.09, 0), 0x9a958a, [0, 0.9, 0.1])], arm, 'catapult-stone');
  // Outrigger feet at the corners: stowed up for travel, planted when set up.
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) for (const z of [-0.65, 0.5]) {
    const leg = b.pivot(b.rig, 'catapult-leg', [side * 0.34, 0.3, z]);
    b.mesh([box([0.05, 0.3, 0.05], DARK_WOOD, [0, -0.15, 0]), box([0.12, 0.03, 0.12], DARK_WOOD, [0, -0.29, 0])], leg, 'catapult-leg');
    leg.userData.side = side;
    legs.push(leg);
  }
  const wheels = b.wheels(0.22, 0.07, [[-0.42, 0.25], [0.42, 0.25], [-0.42, -0.45], [0.42, -0.45]]);
  const reload = UNITS.catapult.reload;
  return {
    object: b.object,
    setPose(pose, t, raw) {
      const extra = extraOf(raw);
      const time = Number.isFinite(t) ? t : 0;
      const deploy = clamp01(extra.deploy ?? 1);
      b.rig.rotation.set(0, 0, 0);
      b.rig.position.set(0, 0, 0);
      roll(wheels, 0.22, pose === 'walk', time);
      // Packing lowers the arm forward onto the frame; setting up winches it back to cocked.
      let angle = lerp(ARM_STOWED, ARM_COCKED, smooth(deploy));
      let since = Infinity;
      if (deploy >= 1 && pose === 'attack') {
        since = extra.sinceFire ?? Infinity;
        angle = catapultArm(since, reload);
        // The onager kicks its rear up as the arm hits the crossbar.
        if (since < 0.5) b.rig.rotation.x = Math.sin(clamp01((since - THROW_SECONDS * 0.6) / 0.34) * Math.PI) * 0.07;
      }
      arm.rotation.set(angle, 0, 0);
      // The stone leaves with the shot and is reloaded once the arm is back down.
      stone.visible = deploy >= 0.9 && (since >= reload * 0.7 || since < THROW_SECONDS * 0.5);
      for (const leg of legs) leg.rotation.set(0, 0, (leg.userData.side as number) * lerp(-1.45, 0.18, smooth(deploy)));
      if (pose === 'die') collapse(b.rig, extra.progress ?? 0);
    },
  };
}

/** Wheeled bolt shooter (scorpion): a torsion bow on a swivel over a two-wheeled carriage. */
function createBoltShooter(color: number, seed: number): SiegeModel {
  const b = builder('boltShooter');
  const wood = [WOOD, 0x8a6740, 0x7a5835][seed % 3];
  b.mesh([
    box([0.08, 0.08, 1.0], DARK_WOOD, [0, 0.28, -0.2]),
    box([0.62, 0.07, 0.08], DARK_WOOD, [0, 0.24, 0]),
    // Trail end with a team-coloured shield board.
    box([0.24, 0.05, 0.16], DARK_WOOD, [0, 0.08, -0.7]),
    box([0.42, 0.26, 0.04], color, [0, 0.42, -0.08], [0.2, 0, 0]),
    box([0.46, 0.04, 0.05], BRONZE, [0, 0.56, -0.05], [0.2, 0, 0]),
  ], b.rig, 'bolt-carriage');
  const wheels = b.wheels(0.24, 0.06, [[-0.36, 0], [0.36, 0]]);
  // Swivel mount carries the stock, bow and string; packing tips it nose-down for travel.
  const mount = b.pivot(b.rig, 'bolt-mount', [0, 0.58, 0.05]);
  b.mesh([
    box([0.09, 0.09, 0.95], wood, [0, 0.06, 0.08]),
    box([0.05, 0.02, 0.7], 0x4b3420, [0, 0.11, 0.05]),
    // Torsion frame: two skeins either side of the stock's nose.
    box([0.34, 0.16, 0.08], DARK_WOOD, [0, 0.07, 0.48]),
    ...[-1, 1].map(side => part(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 6), ROPE, [side * 0.12, 0.07, 0.48])),
    box([0.06, 0.05, 0.06], IRON, [0, 0.12, -0.3]),
    rod(DARK_WOOD, [0, -0.05, 0], [0, -0.2, 0], 0.04, 6),
  ], mount, 'bolt-stock');
  const arms = [-1, 1].map(side => {
    const arm = b.pivot(mount, side < 0 ? 'bolt-arm-left' : 'bolt-arm-right', [side * 0.12, 0.07, 0.48]);
    b.mesh([box([0.32, 0.035, 0.035], WOOD, [side * 0.16, 0, 0])], arm, 'bolt-arm');
    arm.userData.side = side;
    return arm;
  });
  // Straight string between the arm tips, rebuilt from the tips each pose.
  const string = b.mesh([box([1, 0.012, 0.012], ROPE, [0, 0, 0])], mount, 'bolt-string');
  const bolt = b.mesh([
    rod(DARK_WOOD, [0, 0, -0.25], [0, 0, 0.42], 0.012, 4),
    part(new THREE.ConeGeometry(0.022, 0.08, 4), IRON, [0, 0, 0.46], [1, 1, 1], [Math.PI / 2, 0, 0]),
  ], mount, 'bolt-loaded');
  bolt.position.y = 0.14;
  // Tripod legs fold flat under the trail for travel.
  const legs = [-1, 1].map(side => {
    const leg = b.pivot(b.rig, 'bolt-leg', [side * 0.12, 0.26, 0.38]);
    b.mesh([box([0.04, 0.3, 0.04], DARK_WOOD, [0, -0.15, 0])], leg, 'bolt-leg');
    leg.userData.side = side;
    return leg;
  });
  const reload = UNITS.boltShooter.reload;
  const tip = new THREE.Vector3();
  return {
    object: b.object,
    setPose(pose, t, raw) {
      const extra = extraOf(raw);
      const time = Number.isFinite(t) ? t : 0;
      const deploy = clamp01(extra.deploy ?? 1);
      const k = smooth(deploy);
      b.rig.rotation.set(0, 0, 0);
      b.rig.position.set(0, 0, 0);
      roll(wheels, 0.24, pose === 'walk', time);
      mount.rotation.set(lerp(0.55, -0.06, k), 0, 0);
      for (const leg of legs) leg.rotation.set(lerp(1.4, -0.35, k), 0, (leg.userData.side as number) * lerp(0.05, 0.3, k));
      let draw = k;
      let since = Infinity;
      if (deploy >= 1 && pose === 'attack') {
        since = extra.sinceFire ?? Infinity;
        draw = boltDraw(since, reload);
      }
      // Packed, the bow arms fold back along the stock; drawn, they sweep back with the string.
      for (const arm of arms) {
        const side = arm.userData.side as number;
        const fold = lerp(1.25, 0.12 + 0.35 * clamp01(draw), k);
        arm.rotation.set(0, side * fold, 0);
      }
      const reach = 0.32;
      const right = arms[1];
      tip.set(reach * Math.cos(right.rotation.y), 0, -reach * Math.sin(right.rotation.y)).add(right.position);
      // The string sits behind the arm tips by the draw so the snap reads from the side too.
      string.position.set(0, tip.y, tip.z - Math.max(0, draw) * 0.22);
      string.scale.set(Math.max(0.05, tip.x * 2), 1, 1);
      bolt.visible = deploy >= 0.9 && (since >= reload * 0.6 || since < 0.03);
      if (pose === 'die') collapse(b.rig, extra.progress ?? 0);
    },
  };
}

/** Build one siege engine, posed idle and set up. */
export function createSiegeEngine(kind: SiegeKind, opts?: { color?: number; seed?: number }): SiegeModel {
  const seed = Math.abs(Math.trunc(opts?.seed ?? 1));
  const color = opts?.color ?? 0x9e3b26;
  const model = kind === 'ram' ? createRam(color, seed) : kind === 'catapult' ? createCatapult(color, seed) : createBoltShooter(color, seed);
  model.setPose('idle', 0, { deploy: 0 });
  return model;
}
