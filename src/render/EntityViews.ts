import * as THREE from 'three';
import { BUILDINGS, FARM_FOOD } from '../core/buildings';
import { detectQuality, type Quality } from '../core/quality';
import { UNITS } from '../core/units';
import {
  SEA_LEVEL,
  type Building,
  type BuildingKind,
  type Entity,
  type EntityId,
  type EntityKind,
  type NodeKind,
  type PlayerId,
  type ResourceNode,
  type Unit,
  type UnitKind,
  type Vec2,
} from '../core/types';
import type { World } from '../sim/World';
import type { Visibility } from '../sim/visibility';
import { createBuildingVisual, createGhost, footprintMinY, tintGhost, type BuildingVisual } from './buildingVisuals';
import { DeathGhosts } from './deaths';
import { applyFog, createFogDepthMaterial, isConcealed, matrixForConcealment, type FogOfWar } from './fog';
import {
  buildingMayTarget,
  buildingPresentation,
  sightFromState,
  stepLastSeen,
  unitMayShow,
  type LastSeenBuilding,
  type Sight,
} from './lastSeen';
import { HealthBars } from './hpBars';
import { SpatialInstances } from './instanceChunks';
import { berryLodGeometry, goldLodGeometry, stoneLodGeometry, stoneNodeGeometry, treeLodGeometry } from './lod';
import { createUnitAvatar, type UnitAvatar } from './modelBridge';
import { buildingRenderTier, unitTiers } from './tiers';
import {
  berryBushGeometry,
  carcassGeometry,
  fishGeometry,
  goldPileGeometry,
  modelMaterial,
  stumpGeometry,
  treeGeometries,
  type VillagerPose,
} from './models';
import { ENEMY_RING, MOVE_MARKER, SELECTION } from './palette';
import { choosePick, ndcToCanvas, PICK_RANK, rectContains, type PickCandidate } from './picking';
import { ProjectilePool } from './projectiles';
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
  /** Research tiers and the completion shimmer (M8-15). */
  avatar?: UnitAvatar;
  pose(unit: Unit, time: number): void;
  die(age: number): void;
  setOpacity(opacity: number): void;
  shadow: THREE.Mesh;
}

const MARKER_DURATION = 0.6;
/** Units are drawn larger than life (as in classic RTS games) so they stay readable when zoomed out. */
const VILLAGER_SCALE = 1.35;
const VILLAGER_SIZE: SpriteSize = { width: 0.7 * VILLAGER_SCALE, height: 1.0 * VILLAGER_SCALE };
const SCOUT_SCALE = 1.1;
const SCOUT_SIZE: SpriteSize = { width: 1.4 * SCOUT_SCALE, height: 2.0 * SCOUT_SCALE };
const GATHER_POSE: Record<string, VillagerPose> = { wood: 'chop', food: 'forage', gold: 'mine', stone: 'mine' };
const UNIT_SCALE: Record<UnitKind, number> = {
  villager: VILLAGER_SCALE,
  scout: SCOUT_SCALE,
  hoplite: 1.3,
  swordsman: 1.3,
  slinger: 1.25,
  archer: 1.25,
  horseman: 1.15,
  tradeCart: 1.15,
  deer: 1.3,
  boar: 1.3,
  sheep: 1.3,
};
/** World-space bar height, already including the unit's draw scale. */
const BAR_Y: Record<UnitKind, number> = {
  villager: 1.7,
  scout: 2.45,
  hoplite: 1.9,
  swordsman: 1.9,
  slinger: 1.75,
  archer: 1.8,
  horseman: 2.4,
  tradeCart: 1.6,
  deer: 2,
  boar: 1.3,
  sheep: 1.3,
};
const BUILDING_HEIGHT: Record<BuildingKind, number> = {
  townCenter: 4.2,
  house: 2.3,
  storehouse: 2.4,
  granary: 2.5,
  miningCamp: 2.2,
  farm: 0.75,
  barracks: 3.2,
  archeryRange: 3,
  stable: 3,
  watchTower: 4.6,
  palisade: 1.6,
  stoneWall: 2.2,
  gate: 2.4,
  forge: 2.9,
  market: 2.2,
  academy: 3.7,
};
/** Extra height of upgraded watch towers (Guard 1, Fortress 2) over BUILDING_HEIGHT. */
const TOWER_TIER_EXTRA = [0, 1.1, 1.6];

/**
 * Visuals for every sim entity: chunked instanced resources (near mesh + far LOD),
 * animated units, buildings and construction, selection rings and the move marker.
 * Also pooled HP bars, projectiles and death ghosts. Listens for `projectile` and `died`.
 * Public surface: constructor(world, quality?), object, sync, pick, idsInRect, setSelected,
 * flashMarker, setFog, setShadows, showGhost, showLine, hideGhost.
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
  /** Buildings whose owner finished a tech since they were last shown live. */
  private readonly tierDirty = new Set<EntityId>();
  /** Enemy buildings kept on screen after they die in fog, until the site is seen again. */
  private readonly memoryViews = new Map<EntityId, BuildingVisual>();
  private lastSeen = new Map<EntityId, LastSeenBuilding>();
  /** Deaths whose rubble waits until the player looks at the site. */
  private readonly deferredDeaths = new Map<EntityId, LastSeenBuilding>();
  private readonly ghosts = new Map<BuildingKind, THREE.Group>();
  /** Cloned ghosts for a wall-line preview. Capped so a map-length drag stays cheap. */
  private readonly lineGhosts: THREE.Group[] = [];
  private lineKind: BuildingKind | null = null;
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
  private readonly bars: HealthBars;
  private readonly projectiles: ProjectilePool;
  private readonly deaths: DeathGhosts;

  constructor(
    readonly world: World,
    quality: Quality = detectQuality(),
  ) {
    this.geometries = {
      tree: treeGeometries(),
      berry: [berryBushGeometry()],
      gold: [goldPileGeometry()],
      stone: [stoneNodeGeometry()],
      carcass: [carcassGeometry()],
      fish: [fishGeometry()],
    };
    this.lodGeometries = {
      tree: treeLodGeometry(),
      berry: berryLodGeometry(),
      gold: goldLodGeometry(),
      stone: stoneLodGeometry(),
      carcass: carcassGeometry(),
      fish: fishGeometry(),
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

    this.bars = new HealthBars(this.object);
    this.projectiles = new ProjectilePool(this.object, quality);
    this.deaths = new DeathGhosts(this.object, quality);

    this.world.events.on('died', (e) => this.onDied(e));
    this.world.events.on('spawned', (e) => {
      const entity = this.world.get(e.id);
      if (!entity) return;
      if ('carry' in entity) this.mountUnit(entity);
      else if ('complete' in entity) this.mountBuilding(entity);
      else this.mountNode(entity);
    });
    this.world.events.on('projectile', (e) => {
      this.projectiles.launch(e.kind, e.from, e.to, e.flight, (x, z) => this.groundY(x, z));
    });
    this.world.events.on('removed', (e) => this.unmount(e.id));
    this.world.events.on('researched', (e) => this.onResearched(e.owner));
    this.world.events.on('constructed', (e) => {
      const building = this.world.buildings.get(e.id);
      const view = this.buildingViews.get(e.id);
      if (!building || !view) return;
      // Completing in fog must not swap the mesh to the finished model.
      if (building.owner !== this.world.localPlayer && !this.sight().isVisible(building.pos.x, building.pos.z)) return;
      view.setProgress(building.buildProgress, true);
    });

    for (const building of this.world.buildings.values()) this.mountBuilding(building);
    for (const node of this.world.nodes.values()) this.mountNode(node);
    for (const unit of this.world.units.values()) this.mountUnit(unit);
  }

  /**
   * Fog resource nodes, stumps and buildings. Own units stay fully lit — they are the viewers.
   * Other players' units are hidden unless their cell is currently visible.
   * Other players' buildings stay as a last-seen mesh once explored, until the cell is visible again.
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
    for (const view of this.memoryViews.values()) this.fogBuilding(view.object);
    this.stepSight();
    this.fogVersion = -1;
    this.syncFog();
    this.refreshUnitVisibility();
  }

  /** Collapse nodes and stumps on unexplored cells, and hide an unexplored building. */
  syncFog(): void {
    if (!this.fog || this.fog.version === this.fogVersion) return;
    this.fogVersion = this.fog.version;
    this.refreshConcealment();
  }

  /** Update visuals. `alpha` ∈ [0,1] interpolates unit prevPos → pos; `time` in seconds. */
  sync(alpha: number, time: number, camera: THREE.Camera): void {
    this.stepSight();
    this.syncFog();
    this.cullChunks(camera);
    const t = clamp01(alpha);
    this.syncUnits(t, time);
    this.syncBuildings(camera);
    this.syncHealth(t, camera);
    this.syncRings(t);
    this.syncMarker(time);
    this.projectiles.update(time);
    this.deaths.update(time, (owner, x, z, rubble) => this.ghostShown(owner, x, z, rubble));
  }

  /** Entity under a normalised-device-coordinate point, or null. Units win over nodes, which win over buildings. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): EntityId | null {
    this.prepareCamera(camera);
    const hits: PickCandidate[] = [];
    for (const unit of this.world.units.values()) {
      if (!this.unitShown(unit)) continue;
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
      if (!this.buildingTargetable(building)) continue;
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
      if (!this.unitShown(unit)) continue;
      const height = this.sizeOf.get(unit.id)?.height ?? VILLAGER_SIZE.height;
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
    this.deaths.setShadows(on);
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
    this.hideLine();
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

  /**
   * One ghost per wall segment. `rot` is the segment yaw (0 along x, π/2 along z), the same
   * value the sim stores and the mesh copies onto `rotation.y`.
   */
  showLine(kind: BuildingKind, spots: readonly { pos: Vec2; rot: number; valid: boolean }[]): void {
    if (this.activeGhost) this.activeGhost.visible = false;
    this.activeGhost = null;
    if (this.lineKind !== kind) this.clearLineGhosts(kind);
    const n = Math.min(spots.length, 96);
    for (let i = 0; i < n; i++) {
      let ghost = this.lineGhosts[i];
      if (!ghost) {
        ghost = createGhost(kind);
        this.object.add(ghost);
        this.lineGhosts.push(ghost);
      }
      const s = spots[i];
      ghost.visible = true;
      ghost.position.set(s.pos.x, footprintMinY(this.world.hf, kind, s.pos, s.rot), s.pos.z);
      ghost.rotation.y = s.rot;
      tintGhost(ghost, s.valid);
    }
    for (let i = n; i < this.lineGhosts.length; i++) this.lineGhosts[i].visible = false;
  }

  hideGhost(): void {
    if (this.activeGhost) this.activeGhost.visible = false;
    this.hideLine();
  }

  private hideLine(): void {
    for (const g of this.lineGhosts) g.visible = false;
  }

  /** Drop the line pool when the kind changes. Each ghost owns its geometry and materials. */
  private clearLineGhosts(next: BuildingKind | null): void {
    for (const g of this.lineGhosts) {
      g.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      });
      this.object.remove(g);
    }
    this.lineGhosts.length = 0;
    this.lineKind = next;
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

  private mountUnit(unit: Unit): void {
    if (this.villagers.has(unit.id)) return;
    const color = this.ownerColor(unit.owner);
    const avatar = createUnitAvatar(unit.kind, color, unit.id);
    avatar.setTiers(unitTiers(this.researchedBy(unit.owner), unit.kind));
    avatar.object.scale.setScalar(UNIT_SCALE[unit.kind]);
    avatar.object.userData.entityId = unit.id;
    avatar.object.traverse((obj) => {
      obj.castShadow = this.shadows;
      obj.receiveShadow = this.shadows;
    });
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.renderOrder = 2;
    shadow.userData.noShadow = 1;
    shadow.scale.setScalar(unit.kind === 'scout' || unit.kind === 'horseman' ? 1.7 : 1);
    const view: UnitView = {
      object: avatar.object,
      avatar,
      shadow,
      pose: (u, t) => avatar.setPose(this.visualPose(u), t, u.kind === 'villager' ? (u.carry?.type ?? null) : null),
      die: (age) => avatar.setPose('die', age),
      setOpacity: (opacity) => avatar.setOpacity(opacity),
    };
    this.object.add(view.object, shadow);
    this.villagers.set(unit.id, view);
    this.sizeOf.set(unit.id, unit.kind === 'scout' || unit.kind === 'horseman' ? SCOUT_SIZE : VILLAGER_SIZE);
    this.placeUnit(unit, 1, 0);
  }

  private mountNode(node: ResourceNode): void {
    if (this.nodePool.has(node.id)) return;
    const variants = this.geometries[node.kind];
    const variant = node.id % variants.length;
    const geometry = variants[variant];
    const capacity = node.kind === 'tree' ? 48 : 24;
    const pool = this.poolFor(node.kind, variant, geometry, capacity);
    const scale = 0.9 + frac(node.id * 12.9898) * 0.2;
    this.dummy.position.set(node.pos.x, node.kind === 'fish' ? SEA_LEVEL + 0.03 : this.groundY(node.pos.x, node.pos.z), node.pos.z);
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
    const visual = createBuildingVisual(building.kind, this.ownerColor(building.owner),
      buildingRenderTier(this.researchedBy(building.owner), building.kind));
    visual.object.userData.entityId = building.id;
    this.poseBuilding(visual, building.kind, building.pos, building.rot);
    visual.setProgress(building.buildProgress, building.complete);
    if (building.kind === 'farm') visual.setFarmFood(building.food ?? (building.complete ? FARM_FOOD : 0));
    this.applyBuildingShadows(visual.object);
    this.object.add(visual.object);
    this.buildingViews.set(building.id, visual);
    visual.object.visible = this.buildingVisible(building);
    if (this.fog) {
      this.fogBuilding(visual.object);
      this.refreshConcealment();
    }
  }

  private researchedBy(owner: PlayerId) {
    return this.world.players.get(owner)?.researched;
  }

  /**
   * A tech finished: retint that player's units in place (with a short shimmer on the ones
   * that changed) and swap upgraded buildings to their new model.
   */
  private onResearched(owner: PlayerId): void {
    const researched = this.researchedBy(owner);
    if (!researched) return;
    for (const [id, view] of this.villagers) {
      const unit = this.world.units.get(id);
      if (!unit || unit.owner !== owner || !view.avatar) continue;
      if (view.avatar.setTiers(unitTiers(researched, unit.kind))) view.avatar.shimmer();
    }
    // Buildings swap on their next live frame, so a fogged enemy tower keeps its last-seen look.
    for (const id of this.buildingViews.keys()) {
      if (this.world.buildings.get(id)?.owner === owner) this.tierDirty.add(id);
    }
  }

  private refreshTier(building: Building, view: BuildingVisual): void {
    if (!this.tierDirty.delete(building.id)) return;
    if (!view.setTier(buildingRenderTier(this.researchedBy(building.owner), building.kind))) return;
    this.applyBuildingShadows(view.object);
    if (this.fog) this.fogBuilding(view.object);
  }

  private buildingHeight(kind: BuildingKind, id: EntityId): number {
    const base = BUILDING_HEIGHT[kind];
    if (kind !== 'watchTower') return base;
    const tier = (this.buildingViews.get(id) ?? this.memoryViews.get(id))?.tier ?? 0;
    return base + (TOWER_TIER_EXTRA[tier] ?? 0);
  }

  private onDied(e: { id: EntityId; kind: EntityKind; owner: PlayerId; pos: Vec2 }): void {
    const unit = this.villagers.get(e.id);
    if (unit) {
      this.villagers.delete(e.id);
      this.sizeOf.delete(e.id);
      this.object.remove(unit.object, unit.shadow);
      this.deaths.addUnit(unit, e.owner, e.pos, this.ghostShown(e.owner, e.pos.x, e.pos.z, false));
      return;
    }
    if (!isBuildingKind(e.kind)) return;
    const visual = this.buildingViews.get(e.id);
    const enemy = e.owner !== this.world.localPlayer;
    const sight = this.cellSight(e.pos.x, e.pos.z);
    // Died out of sight after we had seen it: keep the mesh until the player looks again.
    if (visual && enemy && sight === 'explored' && this.lastSeen.has(e.id)) {
      this.parkBuilding(e.id, visual);
      const snap = this.lastSeen.get(e.id);
      if (snap) this.deferredDeaths.set(e.id, snap);
      return;
    }
    if (visual) this.dropBuildingView(e.id);
    if (enemy && sight !== 'visible') return;
    this.addBuildingRubble(e.kind, e.owner, e.pos);
  }

  private unmount(id: EntityId): void {
    const villager = this.villagers.get(id);
    if (villager) {
      this.object.remove(villager.object, villager.shadow);
      disposeOwned(villager.object);
      this.villagers.delete(id);
    }
    const pool = this.nodePool.get(id);
    if (pool) {
      const base = pool.remove(id);
      if (base && pool.label.startsWith('tree:')) this.stumps.add(id, base);
      this.nodePool.delete(id);
    }
    if (this.memoryViews.has(id)) {
      this.sizeOf.delete(id);
      if (this.fog) this.refreshConcealment();
      return;
    }
    const building = this.buildingViews.get(id);
    if (building) {
      const snap = this.lastSeen.get(id);
      const park = snap && snap.owner !== this.world.localPlayer && this.cellSight(snap.pos.x, snap.pos.z) === 'explored';
      if (park) this.parkBuilding(id, building);
      else this.dropBuildingView(id);
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

  private syncUnits(alpha: number, time: number): void {
    for (const unit of this.world.units.values()) this.placeUnit(unit, alpha, time);
  }

  private placeUnit(unit: Unit, alpha: number, time: number): void {
    const view = this.villagers.get(unit.id);
    if (!view) return;
    const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
    const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * alpha;
    const ground = this.groundY(x, z);
    const shown = this.unitShown(unit);
    view.object.visible = shown;
    view.shadow.visible = shown;
    view.object.position.set(x, ground, z);
    view.object.rotation.set(0, unit.facing, 0);
    view.pose(unit, time);
    view.shadow.position.set(x, ground + 0.04, z);
  }

  private syncBuildings(camera: THREE.Camera): void {
    for (const building of this.world.buildings.values()) {
      const view = this.buildingViews.get(building.id);
      if (!view) continue;
      const mode = this.presentation(building);
      if (mode === 'hidden') {
        view.object.visible = false;
        continue;
      }
      if (mode === 'snapshot') {
        const snap = this.lastSeen.get(building.id);
        if (!snap) {
          view.object.visible = false;
          continue;
        }
        this.poseBuilding(view, snap.kind, snap.pos, snap.rot);
        view.object.visible = true;
        continue;
      }
      this.refreshTier(building, view);
      this.poseBuilding(view, building.kind, building.pos, building.rot);
      view.setProgress(building.buildProgress, building.complete);
      if (building.kind === 'farm') {
        const food = building.food !== undefined ? building.food : building.complete ? FARM_FOOD : 0;
        view.setFarmFood(food);
      }
      const showBar = !building.complete || this.selected.has(building.id);
      view.setBar(showBar, building.buildProgress, camera);
      view.object.visible = true;
    }
    for (const [id, view] of this.memoryViews) {
      const snap = this.lastSeen.get(id);
      if (!snap) continue;
      this.poseBuilding(view, snap.kind, snap.pos, snap.rot);
      view.object.visible = true;
    }
  }

  private syncHealth(alpha: number, camera: THREE.Camera): void {
    this.bars.begin(camera);
    for (const unit of this.world.units.values()) {
      if (!this.unitShown(unit)) continue;
      if (!this.wantsHealth(unit.hp, unit.maxHp, unit.id)) continue;
      const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
      const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * alpha;
      const width = Math.max(0.62, UNITS[unit.kind].radius * 2.4);
      this.bars.push(x, this.groundY(x, z) + BAR_Y[unit.kind], z, fraction(unit.hp, unit.maxHp), width);
    }
    for (const building of this.world.buildings.values()) {
      const mode = this.presentation(building);
      if (mode === 'hidden') continue;
      if (mode === 'snapshot') {
        const snap = this.lastSeen.get(building.id);
        if (snap) this.pushBuildingBar(snap.kind, snap.pos, snap.hp, snap.maxHp, snap.id);
        continue;
      }
      this.pushBuildingBar(building.kind, building.pos, building.hp, building.maxHp, building.id);
    }
    for (const [id, snap] of this.lastSeen) {
      if (this.world.buildings.has(id) || !this.memoryViews.has(id)) continue;
      this.pushBuildingBar(snap.kind, snap.pos, snap.hp, snap.maxHp, snap.id);
    }
    this.bars.end();
  }

  private syncRings(alpha: number): void {
    let n = 0;
    for (const id of this.selected) {
      const unit = this.world.units.get(id);
      if (!unit) continue;
      if (!this.unitShown(unit)) continue;
      const ring = this.ringMesh(n);
      n += 1;
      const x = unit.prevPos.x + (unit.pos.x - unit.prevPos.x) * alpha;
      const z = unit.prevPos.z + (unit.pos.z - unit.prevPos.z) * alpha;
      ring.position.set(x, this.groundY(x, z) + 0.07, z);
      ring.scale.setScalar(Math.max(1, UNITS[unit.kind].radius / 0.3));
      (ring.material as THREE.MeshBasicMaterial).color.setHex(this.ringColor(unit));
      ring.visible = true;
    }
    for (let i = n; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  private ringMesh(index: number): THREE.Mesh {
    let ring = this.rings[index];
    if (!ring) {
      ring = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
      ring.userData.noShadow = 1;
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
    const y1 = y0 + this.buildingHeight(building.kind, building.id);
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
      view.object.visible = this.buildingVisible(building);
    }
    for (const [id, view] of this.memoryViews) view.object.visible = this.lastSeen.has(id);
  }

  private refreshUnitVisibility(): void {
    for (const [id, view] of this.villagers) {
      const unit = this.world.units.get(id);
      if (!unit) continue;
      const shown = this.unitShown(unit);
      view.object.visible = shown;
      view.shadow.visible = shown;
    }
  }

  /** Local units always draw. Everyone else draws only in a currently visible cell. Garrisoned units are inside. */
  private unitShown(unit: Unit): boolean {
    if (unit.state === 'garrisoned') return false;
    return unitMayShow(unit.owner === this.world.localPlayer, this.cellSight(unit.pos.x, unit.pos.z));
  }

  /**
   * Own buildings hide on unexplored ground once fog is attached.
   * Enemy buildings: live while visible, last-seen mesh while only explored, hidden if never seen.
   */
  private presentation(building: Building): 'live' | 'snapshot' | 'hidden' {
    return buildingPresentation({
      ownerIsLocal: building.owner === this.world.localPlayer,
      sight: this.cellSight(building.pos.x, building.pos.z),
      fogActive: this.fog !== null,
      snap: this.lastSeen.get(building.id),
    });
  }

  private buildingVisible(building: Building): boolean {
    return this.presentation(building) !== 'hidden';
  }

  /** Live enemy buildings only. A last-seen ghost is not a pick or attack target. */
  private buildingTargetable(building: Building): boolean {
    return buildingMayTarget(
      building.owner === this.world.localPlayer,
      this.cellSight(building.pos.x, building.pos.z),
      this.fog !== null,
    );
  }

  /** Footprint height, then xz and yaw. Last-seen ghosts use this with the snapshot pose — not a second transform. */
  private poseBuilding(view: BuildingVisual, kind: BuildingKind, pos: Vec2, rot: number): void {
    const y = footprintMinY(this.world.hf, kind, pos, rot);
    view.object.position.set(pos.x, y, pos.z);
    view.object.rotation.y = rot;
  }

  private pushBuildingBar(kind: BuildingKind, pos: Vec2, hp: number, maxHp: number, id: EntityId): void {
    if (!this.wantsHealth(hp, maxHp, id)) return;
    const { w } = BUILDINGS[kind].size;
    const width = Math.min(2.2, Math.max(0.8, w * 0.55));
    const y = this.groundY(pos.x, pos.z) + this.buildingHeight(kind, id) + 0.95;
    this.bars.push(pos.x, y, pos.z, fraction(hp, maxHp), width);
  }

  private stepSight(): void {
    const stepped = stepLastSeen(
      this.lastSeen,
      this.world.buildings.values(),
      this.world.localPlayer,
      (x, z) => this.cellSight(x, z),
    );
    this.lastSeen = stepped.snaps;
    for (const snap of stepped.confirmedGone) {
      this.dropBuildingView(snap.id);
      const death = this.deferredDeaths.get(snap.id);
      this.deferredDeaths.delete(snap.id);
      if (death) this.addBuildingRubble(death.kind, death.owner, death.pos);
    }
  }

  private parkBuilding(id: EntityId, visual: BuildingVisual): void {
    this.buildingViews.delete(id);
    this.tierDirty.delete(id);
    this.memoryViews.set(id, visual);
    visual.object.visible = true;
  }

  private dropBuildingView(id: EntityId): void {
    const visual = this.memoryViews.get(id) ?? this.buildingViews.get(id);
    if (!visual) return;
    this.object.remove(visual.object);
    disposeMaterials(visual.object);
    this.memoryViews.delete(id);
    this.buildingViews.delete(id);
    this.tierDirty.delete(id);
  }

  private addBuildingRubble(kind: BuildingKind, owner: PlayerId, pos: Vec2): void {
    const { w, d } = BUILDINGS[kind].size;
    this.deaths.addRubble(
      owner,
      pos,
      this.groundY(pos.x, pos.z),
      Math.max(w, d) * 0.55,
      this.ghostShown(owner, pos.x, pos.z, true),
    );
  }

  private cellSight(x: number, z: number): Sight {
    return sightFromState(this.sight().stateAt(x, z));
  }

  private ghostShown(owner: PlayerId, x: number, z: number, rubble: boolean): boolean {
    if (owner === this.world.localPlayer) return true;
    const vis = this.sight();
    return rubble ? vis.isExplored(x, z) : vis.isVisible(x, z);
  }

  private sight(): Visibility {
    return this.fog?.visibility ?? this.world.visibility;
  }

  private ownerColor(owner: PlayerId): number {
    return this.world.players.get(owner)?.player.color ?? SELECTION;
  }

  private ringColor(unit: Unit): number {
    if (this.world.areEnemies(this.world.localPlayer, unit.owner)) return ENEMY_RING;
    return this.ownerColor(unit.owner);
  }

  private wantsHealth(hp: number, maxHp: number, id: EntityId): boolean {
    if (this.selected.has(id)) return true;
    return maxHp > 0 && hp < maxHp - 0.01;
  }

  /** Walk (gallop for the mounted scout) while moving or chasing; attack only in range. */
  private visualPose(unit: Unit): string {
    if (unit.state === 'attacking') return this.inRange(unit) ? 'attack' : movingPose(unit.kind);
    if (unit.kind === 'villager') {
      const pose = poseOf(unit);
      // Farm work swings a sickle (tinted by the farming chain) instead of foraging by hand.
      return pose === 'forage' && unit.gatherNode != null && this.world.buildings.has(unit.gatherNode) ? 'farm' : pose;
    }
    if (isTravelling(unit)) return movingPose(unit.kind);
    return 'idle';
  }

  private inRange(unit: Unit): boolean {
    if (unit.target == null) return false;
    const target = this.world.get(unit.target);
    if (!target) return false;
    const dist = Math.hypot(unit.pos.x - target.pos.x, unit.pos.z - target.pos.z);
    return dist <= UNITS[unit.kind].range + UNITS[unit.kind].radius + bodyRadius(target) + 0.08;
  }
}

function disposeMaterials(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) mats.add(mat);
  });
  for (const mat of mats) mat.dispose();
}

/** Unit models share a few placeholder materials; only dispose ones this avatar owns, plus its unique geometry. */
function disposeOwned(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  const geos = new Set<THREE.BufferGeometry>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) if (mat.userData.owned === 1) mats.add(mat);
    if (mesh.geometry?.userData.dispose === 1) geos.add(mesh.geometry);
  });
  for (const mat of mats) mat.dispose();
  for (const geo of geos) geo.dispose();
}

function isBuildingKind(kind: EntityKind): kind is BuildingKind {
  return Object.prototype.hasOwnProperty.call(BUILDINGS, kind);
}

function movingPose(kind: UnitKind): string {
  return kind === 'scout' ? 'gallop' : 'walk';
}

function isTravelling(unit: Unit): boolean {
  if (unit.path.length > 0) return true;
  switch (unit.state) {
    case 'moving':
    case 'toNode':
    case 'toDrop':
    case 'exploring':
    case 'toBuild':
    case 'toShelter':
      return true;
    default:
      return false;
  }
}

function bodyRadius(entity: Entity): number {
  if ('carry' in entity) return UNITS[entity.kind].radius;
  return entity.radius;
}

function fraction(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0;
  const t = hp / maxHp;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function poseOf(unit: Unit): VillagerPose {
  switch (unit.state) {
    case 'moving':
    case 'toNode':
    case 'toDrop':
    case 'exploring':
    case 'toBuild':
    case 'toShelter':
      return 'walk';
    case 'gathering':
      return GATHER_POSE[unit.gatherType ?? 'food'];
    case 'building':
      return 'build';
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
