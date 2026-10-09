import * as THREE from 'three';
import { BUILDINGS, FARM_FOOD } from '../core/buildings';
import { SEA_LEVEL, type Building, type BuildingKind, type EntityId, type NodeKind, type ResourceNode, type ResourceType, type Unit, type Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { createBuildingVisual, createGhost, footprintMinY, tintGhost, type BuildingVisual } from './buildingVisuals';
import { applyFog, createFogDepthMaterial, isConcealed, matrixForConcealment, type FogOfWar } from './fog';
import { SpatialInstances } from './instanceChunks';
import { berryLodGeometry, goldLodGeometry, stoneLodGeometry, stoneNodeGeometry, treeLodGeometry } from './lod';
import {
  berryBushGeometry,
  createScout,
  createVillager,
  goldPileGeometry,
  modelMaterial,
  stumpGeometry,
  treeGeometries,
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

/** A unit's model plus its blob shadow; `pose` animates it from the unit's sim state. */
interface UnitView {
  object: THREE.Object3D;
  pose(unit: Unit, time: number): void;
  shadow: THREE.Mesh;
}

const MARKER_DURATION = 0.6;
/** Units are drawn larger than life (as in classic RTS games) so they stay readable when zoomed out. */
const VILLAGER_SCALE = 1.35;
const VILLAGER_SIZE: SpriteSize = { width: 0.7 * VILLAGER_SCALE, height: 1.0 * VILLAGER_SCALE };
const SCOUT_SCALE = 1.1;
const SCOUT_SIZE: SpriteSize = { width: 1.4 * SCOUT_SCALE, height: 2.0 * SCOUT_SCALE };
const TUNICS = [0x8b4513, 0x3f6e9a, 0x4f7a3a];
const GATHER_POSE: Record<string, VillagerPose> = { wood: 'chop', food: 'forage', gold: 'mine', stone: 'mine' };
const BUILDING_HEIGHT: Record<BuildingKind, number> = {
  townCenter: 4.2,
  house: 2.3,
  storehouse: 2.4,
  granary: 2.5,
  miningCamp: 2.2,
  farm: 0.75,
};

/**
 * Visuals for every sim entity: chunked instanced resources (near mesh + far LOD),
 * animated villagers, buildings and construction, selection rings and the move marker.
 * Public surface: constructor, object, sync, pick, idsInRect, setSelected, flashMarker,
 * setFog, setShadows, showGhost, hideGhost.
 *
 * The world constructor does not emit `spawned`, so existing entities are mounted here
 * and later spawns/removals follow the event bus. `sync` also frustum-ready LOD-swaps
 * resource chunks from the camera (each chunk mesh carries its own bounding sphere).
 */
export class EntityViews {
  readonly object = new THREE.Group();
  private readonly material = modelMaterial();
  private readonly geometries: Record<NodeKind, THREE.BufferGeometry[]>;
  private readonly lodGeometries: Record<NodeKind, THREE.BufferGeometry>;
  private readonly stumps: SpatialInstances;
  private readonly villagers = new Map<EntityId, UnitView>();
  private readonly pools = new Map<string, SpatialInstances>();
  private readonly nodePool = new Map<EntityId, SpatialInstances>();
  private readonly buildingViews = new Map<EntityId, BuildingVisual>();
  private readonly ghosts = new Map<BuildingKind, THREE.Group>();
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
  private readonly pose = new THREE.Matrix4();
  private selected: ReadonlySet<EntityId> = new Set();
  private shadows = false;
  private markerPos: Vec2 = { x: 0, z: 0 };
  private markerStart: number | null = null;
  private markerPending = false;
  private fog: FogOfWar | null = null;
  private fogVersion = -1;
  private depthMaterial: THREE.Material | null = null;
  private activeGhost: THREE.Group | null = null;

  constructor(readonly world: World) {
    this.geometries = {
      tree: treeGeometries(),
      berry: [berryBushGeometry()],
      gold: [goldPileGeometry()],
      stone: [stoneNodeGeometry()],
    };
    this.lodGeometries = {
      tree: treeLodGeometry(),
      berry: berryLodGeometry(),
      gold: goldLodGeometry(),
      stone: stoneLodGeometry(),
    };
    for (const list of Object.values(this.geometries)) for (const geo of list) if (geo.boundingBox === null) geo.computeBoundingBox();

    this.stumps = new SpatialInstances(this.object, stumpGeometry(), stumpGeometry(), this.material, 'stumps', 32, (mesh) => this.hook(mesh));

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
      if ('carry' in entity) this.mountVillager(entity);
      else if ('complete' in entity) this.mountBuilding(entity);
      else this.mountNode(entity);
    });
    this.world.events.on('removed', (e) => this.unmount(e.id));
    this.world.events.on('constructed', (e) => {
      const building = this.world.buildings.get(e.id);
      const view = this.buildingViews.get(e.id);
      if (building && view) view.setProgress(building.buildProgress, true);
    });

    for (const building of this.world.buildings.values()) this.mountBuilding(building);
    for (const node of this.world.nodes.values()) this.mountNode(node);
    for (const unit of this.world.units.values()) this.mountVillager(unit);
  }

  /**
   * Fog resource nodes, stumps and buildings. Units stay fully lit — they are the viewers.
   * `sync` already calls `syncFog`. Call `fog.update` before `sync` so the mask and the scales match.
   */
  setFog(fog: FogOfWar): void {
    this.fog = fog;
    if (!this.depthMaterial) {
      applyFog(this.material, fog, { hideUnexplored: true });
      this.depthMaterial = createFogDepthMaterial(fog);
    }
    for (const pool of this.pools.values()) pool.forEachMesh((mesh) => this.hook(mesh));
    this.stumps.forEachMesh((mesh) => this.hook(mesh));
    for (const view of this.buildingViews.values()) this.fogBuilding(view.object);
    this.fogVersion = -1;
    this.syncFog();
  }

  /** Collapse nodes and stumps on unexplored cells, and hide an unexplored building. */
  syncFog(): void {
    if (!this.fog || this.fog.version === this.fogVersion) return;
    this.fogVersion = this.fog.version;
    this.refreshConcealment();
  }

  /** Update visuals. `alpha` ∈ [0,1] interpolates unit prevPos → pos; `time` in seconds. */
  sync(alpha: number, time: number, camera: THREE.Camera): void {
    this.syncFog();
    this.cullChunks(camera);
    const t = clamp01(alpha);
    this.syncVillagers(t, time);
    this.syncBuildings(camera);
    this.syncRings(t);
    this.syncMarker(time);
  }

  /** Entity under a normalised-device-coordinate point, or null. Units win over nodes, which win over buildings. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): EntityId | null {
    this.prepareCamera(camera);
    const hits: PickCandidate[] = [];
    for (const unit of this.world.units.values()) {
      const size = this.sizeOf.get(unit.id);
      if (!size) continue;
      this.consider(hits, camera, ndc, unit.id, PICK_RANK.villager, unit.pos.x, unit.pos.z, size);
    }
    for (const node of this.world.nodes.values()) {
      if (this.concealed(node.pos.x, node.pos.z)) continue;
      const size = this.sizeOf.get(node.id);
      if (!size) continue;
      this.consider(hits, camera, ndc, node.id, PICK_RANK.node, node.pos.x, node.pos.z, size);
    }
    for (const building of this.world.buildings.values()) {
      if (this.concealed(building.pos.x, building.pos.z)) continue;
      this.considerBuilding(hits, camera, ndc, building);
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

  /** Let near resource chunks, villagers and buildings cast (and receive) sun shadows. Far LOD chunks never do. */
  setShadows(on: boolean): void {
    this.shadows = on;
    this.object.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.userData.noShadow || mesh.name.endsWith(':lod')) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        return;
      }
      if (mesh.material === this.shadowMat || mesh.material === this.ringMat || mesh.material === this.markerMat) return;
      mesh.castShadow = on;
      mesh.receiveShadow = on;
    });
    for (const pool of this.pools.values()) pool.setShadows(on);
    this.stumps.setShadows(on);
  }

  /**
   * Translucent placement preview of `kind` at `pos`/`rot`, tinted green when `valid`
   * and red otherwise, plus a footprint outline on the ground.
   */
  showGhost(kind: BuildingKind, pos: Vec2, rot: number, valid: boolean): void {
    let ghost = this.ghosts.get(kind);
    if (!ghost) {
      ghost = createGhost(kind);
      this.object.add(ghost);
      this.ghosts.set(kind, ghost);
    }
    if (this.activeGhost && this.activeGhost !== ghost) this.activeGhost.visible = false;
    this.activeGhost = ghost;
    ghost.visible = true;
    ghost.position.set(pos.x, footprintMinY(this.world.hf, kind, pos, rot), pos.z);
    ghost.rotation.y = rot;
    tintGhost(ghost, valid);
  }

  hideGhost(): void {
    if (this.activeGhost) this.activeGhost.visible = false;
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
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.renderOrder = 2;
    let view: UnitView;
    if (unit.kind === 'scout') {
      const model = createScout({ cloak: TUNICS[unit.id % TUNICS.length], seed: unit.id });
      model.object.scale.setScalar(SCOUT_SCALE);
      shadow.scale.setScalar(1.7);
      view = { object: model.object, shadow, pose: (u, t) => model.setPose(u.path.length > 0 ? 'gallop' : 'idle', t) };
      this.sizeOf.set(unit.id, SCOUT_SIZE);
    } else {
      const model = createVillager({ tunic: TUNICS[unit.id % TUNICS.length], seed: unit.id });
      model.object.scale.setScalar(VILLAGER_SCALE);
      view = { object: model.object, shadow, pose: (u, t) => model.setPose(poseOf(u), t, carriedLook(u.carry?.type ?? null)) };
      this.sizeOf.set(unit.id, VILLAGER_SIZE);
    }
    view.object.traverse((obj) => {
      obj.castShadow = this.shadows;
      obj.receiveShadow = this.shadows;
    });
    this.object.add(view.object, shadow);
    this.villagers.set(unit.id, view);
    this.placeVillager(unit, 1, 0);
  }

  private mountNode(node: ResourceNode): void {
    if (this.nodePool.has(node.id)) return;
    const variants = this.geometries[node.kind];
    const variant = node.id % variants.length;
    const geometry = variants[variant];
    const capacity = node.kind === 'tree' ? 48 : 24;
    const pool = this.poolFor(node.kind, variant, geometry, capacity);
    const scale = 0.9 + frac(node.id * 12.9898) * 0.2;
    this.dummy.position.set(node.pos.x, this.groundY(node.pos.x, node.pos.z), node.pos.z);
    this.dummy.rotation.set(0, frac(node.id * 78.233) * Math.PI * 2, 0);
    this.dummy.scale.set(scale, scale, scale);
    this.dummy.updateMatrix();
    pool.add(node.id, this.dummy.matrix);
    this.nodePool.set(node.id, pool);
    const box = geometry.boundingBox;
    const width = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * scale : 1;
    const height = box ? box.max.y * scale : 1;
    this.sizeOf.set(node.id, { width, height });
    if (this.fog) this.refreshConcealment();
  }

  private mountBuilding(building: Building): void {
    if (this.buildingViews.has(building.id)) return;
    const visual = createBuildingVisual(building.kind);
    const y = footprintMinY(this.world.hf, building.kind, building.pos, building.rot);
    visual.object.position.set(building.pos.x, y, building.pos.z);
    visual.object.rotation.y = building.rot;
    visual.setProgress(building.buildProgress, building.complete);
    if (building.kind === 'farm') visual.setFarmFood(building.food ?? (building.complete ? FARM_FOOD : 0));
    this.applyBuildingShadows(visual.object);
    this.object.add(visual.object);
    this.buildingViews.set(building.id, visual);
    if (this.fog) {
      this.fogBuilding(visual.object);
      this.refreshConcealment();
    }
  }

  private unmount(id: EntityId): void {
    const villager = this.villagers.get(id);
    if (villager) {
      this.object.remove(villager.object, villager.shadow);
      this.villagers.delete(id);
    }
    const pool = this.nodePool.get(id);
    if (pool) {
      const base = pool.remove(id);
      if (base && pool.label.startsWith('tree:')) this.stumps.add(id, base);
      this.nodePool.delete(id);
    }
    const building = this.buildingViews.get(id);
    if (building) {
      this.object.remove(building.object);
      disposeMaterials(building.object);
      this.buildingViews.delete(id);
    }
    this.sizeOf.delete(id);
    if (this.fog) this.refreshConcealment();
  }

  private poolFor(kind: NodeKind, variant: number, geometry: THREE.BufferGeometry, capacity: number): SpatialInstances {
    const key = `${kind}:${variant}`;
    let pool = this.pools.get(key);
    if (!pool) {
      pool = new SpatialInstances(this.object, geometry, this.lodGeometries[kind], this.material, key, capacity, (mesh) => this.hook(mesh));
      this.pools.set(key, pool);
    }
    return pool;
  }

  private syncVillagers(alpha: number, time: number): void {
    for (const unit of this.world.units.values()) this.placeVillager(unit, alpha, time);
  }

  private placeVillager(unit: Unit, alpha: number, time: number): void {
    const view = this.villagers.get(unit.id);
    if (!view) return;
    const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
    const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * alpha;
    const ground = this.groundY(x, z);
    view.object.position.set(x, ground, z);
    view.object.rotation.set(0, unit.facing, 0);
    view.pose(unit, time);
    view.shadow.position.set(x, ground + 0.04, z);
  }

  private syncBuildings(camera: THREE.Camera): void {
    for (const building of this.world.buildings.values()) {
      const view = this.buildingViews.get(building.id);
      if (!view) continue;
      view.setProgress(building.buildProgress, building.complete);
      if (building.kind === 'farm') {
        const food = building.food !== undefined ? building.food : building.complete ? FARM_FOOD : 0;
        view.setFarmFood(food);
      }
      const showBar = !building.complete || this.selected.has(building.id);
      view.setBar(showBar, building.buildProgress, camera);
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
      ring.scale.setScalar(unit.kind === 'scout' ? 1.8 : 1);
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

  private considerBuilding(hits: PickCandidate[], camera: THREE.Camera, ndc: THREE.Vector2, building: Building): void {
    const { w, d } = BUILDINGS[building.kind].size;
    const hw = w / 2;
    const hd = d / 2;
    const cos = Math.cos(building.rot);
    const sin = Math.sin(building.rot);
    const y0 = this.groundY(building.pos.x, building.pos.z);
    const y1 = y0 + BUILDING_HEIGHT[building.kind];
    this.v.set(building.pos.x, (y0 + y1) * 0.5, building.pos.z).applyMatrix4(camera.matrixWorldInverse);
    if (this.v.z >= 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const y of [y0, y1]) {
      for (const lx of [-hw, hw]) {
        for (const lz of [-hd, hd]) {
          const x = building.pos.x + lx * cos - lz * sin;
          const z = building.pos.z + lx * sin + lz * cos;
          this.v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          if (this.v.z >= 0) continue;
          this.v.set(x, y, z).project(camera);
          if (this.v.x < minX) minX = this.v.x;
          if (this.v.x > maxX) maxX = this.v.x;
          if (this.v.y < minY) minY = this.v.y;
          if (this.v.y > maxY) maxY = this.v.y;
        }
      }
    }
    if (minX === Infinity || !rectContains(ndc.x, ndc.y, minX, minY, maxX, maxY)) return;
    const dx = camera.position.x - building.pos.x;
    const dy = camera.position.y - (y0 + y1) * 0.5;
    const dz = camera.position.z - building.pos.z;
    hits.push({ id: building.id, rank: PICK_RANK.townCenter, depth: dx * dx + dy * dy + dz * dz });
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

  private concealed(x: number, z: number): boolean {
    return this.fog ? isConcealed(this.fog.visibility, x, z) : false;
  }

  private hook(mesh: THREE.Object3D): void {
    if (this.depthMaterial) mesh.customDepthMaterial = this.depthMaterial;
    if (mesh.userData.agFogHook) return;
    mesh.userData.agFogHook = 1;
    mesh.onBeforeRender = () => this.syncFog();
  }

  private fogBuilding(group: THREE.Object3D): void {
    if (!this.fog) return;
    const fog = this.fog;
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.noShadow) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) applyFog(mat, fog, { hideUnexplored: true });
      this.hook(mesh);
    });
  }

  private applyBuildingShadows(group: THREE.Object3D): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.userData.noShadow) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        return;
      }
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = this.shadows;
    });
  }

  /** Near/far swap from the camera. Off-screen rejection is each chunk's bounding sphere. */
  private cullChunks(camera: THREE.Camera): void {
    const x = camera.position.x;
    const z = camera.position.z;
    for (const pool of this.pools.values()) pool.cull(x, z, this.shadows);
    this.stumps.cull(x, z, this.shadows);
  }

  /** Zero the scale of nodes and stumps on unexplored cells; restore it once seen. */
  private refreshConcealment(): void {
    if (!this.fog) return;
    const vis = this.fog.visibility;
    const hidden = (x: number, z: number) => isConcealed(vis, x, z);
    for (const pool of this.pools.values()) pool.conceal(hidden, this.pose, matrixForConcealment);
    this.stumps.conceal(hidden, this.pose, matrixForConcealment);
    for (const [id, view] of this.buildingViews) {
      const building = this.world.buildings.get(id);
      if (!building) continue;
      view.object.visible = !isConcealed(vis, building.pos.x, building.pos.z);
    }
  }
}

function disposeMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) mat.dispose();
  });
}

function poseOf(unit: Unit): VillagerPose {
  switch (unit.state) {
    case 'moving':
    case 'toNode':
    case 'toDrop':
    case 'exploring':
    case 'toBuild':
      return 'walk';
    case 'gathering':
      return GATHER_POSE[unit.gatherType ?? 'food'];
    case 'building':
      return 'chop';
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

/** Villager models show wood, food or gold bundles; stone reuses the gold look until models grow a stone bundle. */
function carriedLook(type: ResourceType | null): 'wood' | 'food' | 'gold' | null {
  return type === 'stone' ? 'gold' : type;
}
