import * as THREE from 'three';
import { SEA_LEVEL, type Building, type EntityId, type NodeKind, type ResourceNode, type Unit, type Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { buildTownCenter } from './buildings';
import {
  berryBushGeometry,
  createVillager,
  goldPileGeometry,
  modelMaterial,
  stumpGeometry,
  treeGeometries,
  type VillagerModel,
  type VillagerPose,
} from './models';
import { MOVE_MARKER, SELECTION } from './palette';
import { choosePick, ndcToCanvas, PICK_RANK, rectContains, type PickCandidate } from './picking';
import { createShadowTexture } from './shadow';

/** Screen-space rectangle in CSS pixels relative to the canvas. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface SpriteSize {
  width: number;
  height: number;
}

interface VillagerView {
  model: VillagerModel;
  shadow: THREE.Mesh;
}

const MARKER_DURATION = 0.6;
const TC_SIZE: SpriteSize = { width: 3.05, height: 3.85 };
/** Units are drawn larger than life (as in classic RTS games) so they stay readable when zoomed out. */
const VILLAGER_SCALE = 1.35;
const VILLAGER_SIZE: SpriteSize = { width: 0.7 * VILLAGER_SCALE, height: 1.0 * VILLAGER_SCALE };
const TUNICS = [0x8b4513, 0x3f6e9a, 0x4f7a3a];
const GATHER_POSE: Record<string, VillagerPose> = { wood: 'chop', food: 'forage', gold: 'mine' };

/**
 * Visuals for every sim entity: low-poly 3D models (instanced for resources, animated
 * for villagers), the Town Center, stumps left by felled trees, selection rings and the
 * move marker. Subscribes to world.events for spawned/removed.
 * Public surface FROZEN: constructor, object, sync, pick, idsInRect, setSelected, flashMarker.
 *
 * The world constructor does not emit `spawned`, so existing entities are mounted here
 * and later spawns/removals follow the event bus.
 */
export class EntityViews {
  readonly object = new THREE.Group();
  private readonly material = modelMaterial();
  private readonly geometries: Record<NodeKind, THREE.BufferGeometry[]>;
  private readonly stumps: InstancePool;
  private readonly villagers = new Map<EntityId, VillagerView>();
  private readonly pools = new Map<string, InstancePool>();
  private readonly nodePool = new Map<EntityId, InstancePool>();
  private readonly buildings = new Map<EntityId, THREE.Group>();
  private readonly sizeOf = new Map<EntityId, SpriteSize>();
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringGeo: THREE.BufferGeometry;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly shadowGeo: THREE.BufferGeometry;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly markerMesh: THREE.Mesh;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly dummy = new THREE.Object3D();
  private readonly v = new THREE.Vector3();
  private selected: ReadonlySet<EntityId> = new Set();
  private markerPos: Vec2 = { x: 0, z: 0 };
  private markerStart: number | null = null;
  private markerPending = false;

  constructor(readonly world: World) {
    this.geometries = { tree: treeGeometries(), berry: [berryBushGeometry()], gold: [goldPileGeometry()] };
    for (const list of Object.values(this.geometries)) for (const geo of list) geo.computeBoundingBox();
    this.stumps = new InstancePool(stumpGeometry(), this.material, 64);
    this.stumps.mesh.name = 'stumps';
    this.object.add(this.stumps.mesh);

    this.shadowGeo = new THREE.PlaneGeometry(1.4, 1.4);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: createShadowTexture(),
      transparent: true,
      depthWrite: false,
    });

    this.ringGeo = new THREE.RingGeometry(0.42, 0.58, 28);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: SELECTION,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.markerMat = new THREE.MeshBasicMaterial({
      color: MOVE_MARKER,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const markerGeo = new THREE.RingGeometry(0.5, 0.66, 32);
    markerGeo.rotateX(-Math.PI / 2);
    this.markerMesh = new THREE.Mesh(markerGeo, this.markerMat);
    this.markerMesh.visible = false;
    this.markerMesh.renderOrder = 4;
    this.object.add(this.markerMesh);

    this.world.events.on('spawned', (e) => {
      const entity = this.world.get(e.id);
      if (!entity) return;
      if (entity.kind === 'villager') this.mountVillager(entity);
      else if (entity.kind === 'townCenter') this.mountTownCenter(entity);
      else this.mountNode(entity);
    });
    this.world.events.on('removed', (e) => this.unmount(e.id));

    for (const building of this.world.buildings.values()) this.mountTownCenter(building);
    for (const node of this.world.nodes.values()) this.mountNode(node);
    for (const unit of this.world.units.values()) this.mountVillager(unit);
  }

  /** Update visuals. `alpha` ∈ [0,1] interpolates unit prevPos → pos; `time` in seconds. */
  sync(alpha: number, time: number, camera: THREE.Camera): void {
    const t = clamp01(alpha);
    this.syncVillagers(t, time, camera);
    this.syncRings(t);
    this.syncMarker(time);
  }

  /** Entity under a normalised-device-coordinate point, or null. Units win over nodes. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): EntityId | null {
    this.prepareCamera(camera);
    const hits: PickCandidate[] = [];
    for (const unit of this.world.units.values()) {
      const size = this.sizeOf.get(unit.id);
      if (!size) continue;
      this.consider(hits, camera, ndc, unit.id, PICK_RANK.villager, unit.pos.x, unit.pos.z, size);
    }
    for (const node of this.world.nodes.values()) {
      const size = this.sizeOf.get(node.id);
      if (!size) continue;
      this.consider(hits, camera, ndc, node.id, PICK_RANK.node, node.pos.x, node.pos.z, size);
    }
    for (const building of this.world.buildings.values()) {
      this.consider(hits, camera, ndc, building.id, PICK_RANK.townCenter, building.pos.x, building.pos.z, TC_SIZE);
    }
    return choosePick(hits);
  }

  /**
   * Villagers whose projected foot or body centre lies inside `rect` (canvas CSS pixels).
   * A drag box may be inverted.
   */
  idsInRect(rect: ScreenRect, camera: THREE.Camera, viewport: { width: number; height: number }): EntityId[] {
    const ids: EntityId[] = [];
    if (viewport.width <= 0 || viewport.height <= 0) return ids;
    this.prepareCamera(camera);
    for (const unit of this.world.units.values()) {
      const height = VILLAGER_SIZE.height;
      const x = unit.pos.x;
      const z = unit.pos.z;
      const footY = this.groundY(x, z);
      if (this.pointInRect(camera, rect, viewport, x, footY, z) || this.pointInRect(camera, rect, viewport, x, footY + height * 0.5, z)) {
        ids.push(unit.id);
      }
    }
    return ids;
  }

  setSelected(ids: ReadonlySet<EntityId>): void {
    this.selected = ids;
  }

  /** Show the move-order marker at a ground position. */
  flashMarker(p: Vec2): void {
    this.markerPos = { x: p.x, z: p.z };
    this.markerPending = true;
    this.markerMesh.visible = true;
  }

  private mountVillager(unit: Unit): void {
    if (this.villagers.has(unit.id)) return;
    const model = createVillager({ tunic: TUNICS[unit.id % TUNICS.length], seed: unit.id });
    model.object.scale.setScalar(VILLAGER_SCALE);
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.renderOrder = 2;
    this.object.add(model.object, shadow);
    this.villagers.set(unit.id, { model, shadow });
    this.sizeOf.set(unit.id, VILLAGER_SIZE);
    this.placeVillager(unit, 1, 0);
  }

  private mountNode(node: ResourceNode): void {
    if (this.nodePool.has(node.id)) return;
    const variants = this.geometries[node.kind];
    const variant = node.id % variants.length;
    const geometry = variants[variant];
    const capacity = node.kind === 'tree' ? 512 : node.kind === 'berry' ? 256 : 128;
    const pool = this.poolFor(`${node.kind}:${variant}`, geometry, capacity);
    if (pool.ids.length >= pool.mesh.instanceMatrix.count) this.grow(pool);
    const scale = 0.9 + frac(node.id * 12.9898) * 0.2;
    pool.add(node.id, scale);
    this.nodePool.set(node.id, pool);
    const box = geometry.boundingBox as THREE.Box3;
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * scale;
    this.sizeOf.set(node.id, { width, height: box.max.y * scale });
    this.dummy.position.set(node.pos.x, this.groundY(node.pos.x, node.pos.z), node.pos.z);
    this.dummy.rotation.set(0, frac(node.id * 78.233) * Math.PI * 2, 0);
    this.dummy.scale.set(scale, scale, scale);
    this.dummy.updateMatrix();
    pool.mesh.setMatrixAt(pool.ids.length - 1, this.dummy.matrix);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  private mountTownCenter(building: Building): void {
    if (this.buildings.has(building.id)) return;
    const group = buildTownCenter(this.groundY(building.pos.x, building.pos.z));
    group.position.x = building.pos.x;
    group.position.z = building.pos.z;
    this.object.add(group);
    this.buildings.set(building.id, group);
  }

  private unmount(id: EntityId): void {
    const villager = this.villagers.get(id);
    if (villager) {
      this.object.remove(villager.model.object, villager.shadow);
      this.villagers.delete(id);
    }
    const pool = this.nodePool.get(id);
    if (pool) {
      if (pool.mesh.name.startsWith('tree:')) this.leaveStump(pool, id);
      pool.remove(id);
      this.nodePool.delete(id);
    }
    const building = this.buildings.get(id);
    if (building) {
      this.object.remove(building);
      this.buildings.delete(id);
    }
    this.sizeOf.delete(id);
  }

  /** A felled tree leaves a stump where it stood (same position, yaw and scale). */
  private leaveStump(pool: InstancePool, id: EntityId): void {
    const index = pool.indexOf.get(id);
    if (index === undefined) return;
    if (this.stumps.ids.length >= this.stumps.mesh.instanceMatrix.count) this.grow(this.stumps);
    pool.mesh.getMatrixAt(index, this.dummy.matrix);
    this.stumps.add(id, 1);
    this.stumps.mesh.setMatrixAt(this.stumps.ids.length - 1, this.dummy.matrix);
    this.stumps.mesh.instanceMatrix.needsUpdate = true;
  }

  private poolFor(key: string, geometry: THREE.BufferGeometry, capacity: number): InstancePool {
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new InstancePool(geometry, this.material, capacity);
      pool.mesh.name = key;
      this.object.add(pool.mesh);
      this.pools.set(key, pool);
    }
    return pool;
  }

  private grow(pool: InstancePool): void {
    const src = pool.mesh;
    const next = new THREE.InstancedMesh(src.geometry, src.material, src.instanceMatrix.count * 2);
    next.name = src.name;
    next.frustumCulled = false;
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    next.count = pool.ids.length;
    for (let i = 0; i < pool.ids.length; i++) {
      src.getMatrixAt(i, this.dummy.matrix);
      next.setMatrixAt(i, this.dummy.matrix);
    }
    next.instanceMatrix.needsUpdate = true;
    this.object.remove(src);
    this.object.add(next);
    pool.mesh = next;
  }

  private syncVillagers(alpha: number, time: number, _camera: THREE.Camera): void {
    for (const unit of this.world.units.values()) this.placeVillager(unit, alpha, time);
  }

  private placeVillager(unit: Unit, alpha: number, time: number): void {
    const view = this.villagers.get(unit.id);
    if (!view) return;
    const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
    const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * alpha;
    const ground = this.groundY(x, z);
    view.model.object.position.set(x, ground, z);
    view.model.object.rotation.set(0, unit.facing, 0);
    view.model.setPose(poseOf(unit), time, unit.carry?.type ?? null);
    view.shadow.position.set(x, ground + 0.04, z);
  }

  private syncRings(alpha: number): void {
    let n = 0;
    for (const id of this.selected) {
      const unit = this.world.units.get(id);
      if (!unit) continue;
      const ring = this.ringMesh(n);
      n += 1;
      const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
      const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * alpha;
      ring.position.set(x, this.groundY(x, z) + 0.07, z);
      ring.visible = true;
    }
    for (let i = n; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  private ringMesh(index: number): THREE.Mesh {
    let ring = this.rings[index];
    if (!ring) {
      ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      ring.renderOrder = 3;
      ring.visible = false;
      this.object.add(ring);
      this.rings.push(ring);
    }
    return ring;
  }

  private syncMarker(time: number): void {
    if (this.markerPending) {
      this.markerStart = time;
      this.markerPending = false;
    }
    if (this.markerStart === null) return;
    const age = time - this.markerStart;
    if (age < 0 || age >= MARKER_DURATION) {
      this.markerMesh.visible = false;
      this.markerStart = null;
      return;
    }
    const k = age / MARKER_DURATION;
    const expand = 1 - (1 - k) * (1 - k);
    this.markerMesh.scale.setScalar(0.35 + expand * 2.15);
    this.markerMat.opacity = 0.95 * (1 - k);
    this.markerMesh.position.set(this.markerPos.x, this.groundY(this.markerPos.x, this.markerPos.z) + 0.08, this.markerPos.z);
    this.markerMesh.visible = true;
  }

  private consider(
    hits: PickCandidate[],
    camera: THREE.Camera,
    ndc: THREE.Vector2,
    id: EntityId,
    rank: number,
    x: number,
    z: number,
    size: SpriteSize,
  ): void {
    const footY = this.groundY(x, z);
    const midY = footY + size.height * 0.5;
    this.v.set(x, midY, z).applyMatrix4(camera.matrixWorldInverse);
    if (this.v.z >= 0) return;

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const toX = camX - x;
    const toZ = camZ - z;
    const len = Math.hypot(toX, toZ);
    const px = len < 1e-4 ? 1 : -toZ / len;
    const pz = len < 1e-4 ? 0 : toX / len;
    const hw = size.width * 0.5;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const y of [footY, footY + size.height]) {
      for (const side of [-1, 1]) {
        this.v.set(x + px * hw * side, y, z + pz * hw * side).project(camera);
        if (this.v.x < minX) minX = this.v.x;
        if (this.v.x > maxX) maxX = this.v.x;
        if (this.v.y < minY) minY = this.v.y;
        if (this.v.y > maxY) maxY = this.v.y;
      }
    }
    if (!rectContains(ndc.x, ndc.y, minX, minY, maxX, maxY)) return;
    const dy = camera.position.y - midY;
    hits.push({ id, rank, depth: toX * toX + dy * dy + toZ * toZ });
  }

  private pointInRect(
    camera: THREE.Camera,
    rect: ScreenRect,
    viewport: { width: number; height: number },
    x: number,
    y: number,
    z: number,
  ): boolean {
    this.v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    if (this.v.z >= 0) return false;
    this.v.set(x, y, z).project(camera);
    const p = ndcToCanvas(this.v.x, this.v.y, viewport.width, viewport.height);
    return rectContains(p.x, p.y, rect.x0, rect.y0, rect.x1, rect.y1);
  }

  private prepareCamera(camera: THREE.Camera): void {
    const projective = camera as THREE.PerspectiveCamera;
    if (projective.isPerspectiveCamera || (camera as THREE.OrthographicCamera).isOrthographicCamera) {
      projective.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  }

  private groundY(x: number, z: number): number {
    return Math.max(this.world.hf.heightAt(x, z), SEA_LEVEL);
  }
}

class InstancePool {
  readonly ids: EntityId[] = [];
  readonly scales: number[] = [];
  readonly indexOf = new Map<EntityId, number>();
  mesh: THREE.InstancedMesh;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  add(id: EntityId, scale: number): void {
    const index = this.ids.length;
    this.ids.push(id);
    this.scales.push(scale);
    this.indexOf.set(id, index);
    this.mesh.count = this.ids.length;
  }

  remove(id: EntityId): void {
    const index = this.indexOf.get(id);
    if (index === undefined) return;
    const last = this.ids.length - 1;
    if (index !== last) {
      const moved = this.ids[last];
      this.ids[index] = moved;
      this.scales[index] = this.scales[last];
      this.indexOf.set(moved, index);
      this.mesh.getMatrixAt(last, swapMatrix);
      this.mesh.setMatrixAt(index, swapMatrix);
    }
    this.ids.pop();
    this.scales.pop();
    this.indexOf.delete(id);
    this.mesh.count = this.ids.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const swapMatrix = new THREE.Matrix4();

function poseOf(unit: Unit): VillagerPose {
  switch (unit.state) {
    case 'moving':
    case 'toNode':
    case 'toDrop':
      return 'walk';
    case 'gathering':
      return GATHER_POSE[unit.gatherType ?? 'food'];
    default:
      return 'idle';
  }
}

function frac(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
