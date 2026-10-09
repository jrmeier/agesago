import * as THREE from 'three';
import { SEA_LEVEL, type Building, type EntityId, type ResourceNode, type Unit, type Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { buildTownCenter } from './buildings';
import { MOVE_MARKER, SELECTION } from './palette';
import { choosePick, ndcToCanvas, PICK_RANK, rectContains, type PickCandidate } from './picking';
import { createSprites, type BillboardSprite, type SpriteSet } from './sprites';

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
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
}

const MARKER_DURATION = 0.6;
const TC_SIZE: SpriteSize = { width: 3.05, height: 3.85 };

/**
 * Visuals for every sim entity: Y-axis billboard sprites (instanced where possible),
 * the Town Center mesh, selection rings and the move marker. Subscribes to world.events
 * for spawned/removed. Owned by the Render lane (T4).
 * Public surface FROZEN: constructor, object, sync, pick, idsInRect, setSelected, flashMarker.
 *
 * The world constructor does not emit `spawned`, so existing entities are mounted here
 * and later spawns/removals follow the event bus.
 */
export class EntityViews {
  readonly object = new THREE.Group();
  private readonly sprites: SpriteSet;
  private readonly villagers = new Map<EntityId, VillagerView>();
  private readonly villagerGeo = new Map<number, THREE.BufferGeometry>();
  private readonly villagerMat = new Map<number, THREE.Material>();
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
    this.sprites = createSprites();
    this.shadowGeo = new THREE.PlaneGeometry(1.55, 1.55);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: this.sprites.shadow,
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
    this.syncNodes(camera);
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
      const size = this.sizeOf.get(unit.id);
      const height = size?.height ?? 1.7;
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
    const variant = unit.id % this.sprites.villagers.length;
    const frame = this.sprites.villagers[variant];
    let geo = this.villagerGeo.get(variant);
    if (!geo) {
      geo = billboardGeometry(frame.width, frame.height);
      this.villagerGeo.set(variant, geo);
    }
    let mat = this.villagerMat.get(variant);
    if (!mat) {
      mat = spriteMaterial(frame.texture);
      this.villagerMat.set(variant, mat);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.renderOrder = 2;
    this.object.add(mesh, shadow);
    this.villagers.set(unit.id, { mesh, shadow });
    this.sizeOf.set(unit.id, { width: frame.width, height: frame.height });
    this.placeVillager(unit, 1, 0, null);
  }

  private mountNode(node: ResourceNode): void {
    if (this.nodePool.has(node.id)) return;
    const frames =
      node.kind === 'tree' ? this.sprites.trees : node.kind === 'berry' ? [this.sprites.berry] : [this.sprites.gold];
    const variant = node.id % frames.length;
    const frame = frames[variant];
    const capacity = node.kind === 'tree' ? 512 : node.kind === 'berry' ? 256 : 128;
    const pool = this.poolFor(`${node.kind}:${variant}`, frame, capacity);
    if (pool.ids.length >= pool.mesh.instanceMatrix.count) this.grow(pool);
    const scale = 0.9 + frac(node.id * 12.9898) * 0.2;
    pool.add(node.id, scale);
    this.nodePool.set(node.id, pool);
    this.sizeOf.set(node.id, { width: frame.width * scale, height: frame.height * scale });
    const index = pool.ids.length - 1;
    this.dummy.position.set(node.pos.x, this.groundY(node.pos.x, node.pos.z), node.pos.z);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(scale, scale, scale);
    this.dummy.updateMatrix();
    pool.mesh.setMatrixAt(index, this.dummy.matrix);
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
      this.object.remove(villager.mesh, villager.shadow);
      this.villagers.delete(id);
    }
    const pool = this.nodePool.get(id);
    if (pool) {
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

  private poolFor(key: string, frame: BillboardSprite, capacity: number): InstancePool {
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new InstancePool(frame, capacity);
      this.object.add(pool.mesh);
      this.pools.set(key, pool);
    }
    return pool;
  }

  private grow(pool: InstancePool): void {
    const src = pool.mesh;
    const next = new THREE.InstancedMesh(src.geometry, src.material, src.instanceMatrix.count * 2);
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

  private syncVillagers(alpha: number, time: number, camera: THREE.Camera): void {
    for (const unit of this.world.units.values()) this.placeVillager(unit, alpha, time, camera);
  }

  private placeVillager(unit: Unit, alpha: number, time: number, camera: THREE.Camera | null): void {
    const view = this.villagers.get(unit.id);
    if (!view) return;
    const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
    const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * alpha;
    const ground = this.groundY(x, z);
    const moving = unit.state === 'moving' || unit.state === 'toNode' || unit.state === 'toDrop';
    const bob = moving ? Math.sin(time * 9 + unit.id * 1.7) * 0.045 : 0;
    view.mesh.position.set(x, ground + bob, z);
    view.mesh.rotation.set(0, camera ? yaw(camera, x, z) : 0, 0);
    view.shadow.position.set(x, ground + 0.04, z);
  }

  private syncNodes(camera: THREE.Camera): void {
    for (const pool of this.pools.values()) {
      for (let i = 0; i < pool.ids.length; i++) {
        const node = this.world.nodes.get(pool.ids[i]);
        if (!node) {
          this.dummy.position.set(0, 0, 0);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.scale.set(0, 0, 0);
        } else {
          const x = node.pos.x;
          const z = node.pos.z;
          const s = pool.scales[i];
          this.dummy.position.set(x, this.groundY(x, z), z);
          this.dummy.rotation.set(0, yaw(camera, x, z), 0);
          this.dummy.scale.set(s, s, s);
        }
        this.dummy.updateMatrix();
        pool.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      pool.mesh.instanceMatrix.needsUpdate = pool.ids.length > 0;
    }
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

  constructor(frame: BillboardSprite, capacity: number) {
    this.mesh = new THREE.InstancedMesh(billboardGeometry(frame.width, frame.height), spriteMaterial(frame.texture), capacity);
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

function billboardGeometry(width: number, height: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, height);
  geo.translate(0, height / 2, 0);
  return geo;
}

function spriteMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: 0.4,
    side: THREE.FrontSide,
  });
}

function yaw(camera: THREE.Camera, x: number, z: number): number {
  return Math.atan2(camera.position.x - x, camera.position.z - z);
}

function frac(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
