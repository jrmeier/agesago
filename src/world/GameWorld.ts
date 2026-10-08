import * as THREE from 'three';
import { Biome, Landscape } from './Landscape';
import { CameraRig } from './CameraRig';
import { buildTownCenter } from './Props';
import { Terrain } from './Terrain';
import { EconomyHooks, Villager } from './Villager';
import { ResourceNode, ResourceType } from './Resource';
import { Billboard, loadSpriteTextures, type SpriteKey } from './Sprites';
import { SKY_HORIZON, SKY_TOP, SUN_COLOR } from './config';
import { FogOfWar } from './FogOfWar';

interface Sheep {
  bb: Billboard;
  pos: THREE.Vector2;
  target: THREE.Vector2 | null;
  wait: number;
}

const TRAIN_COST = 50;
const TOWN_VISION = 11;
const UNIT_VISION = 9;

export class GameWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();

  private land = new Landscape(7);
  private terrain: Terrain;
  private fog: FogOfWar;
  private rig: CameraRig;

  private villagers: Villager[] = [];
  private villagerByObj = new Map<THREE.Object3D, Villager>();
  private selected = new Set<Villager>();
  private nodes: ResourceNode[] = [];
  private nodeByObj = new Map<THREE.Object3D, ResourceNode>();
  private billboards: Billboard[] = [];
  private sheep: Sheep[] = [];
  private tex: Record<SpriteKey, THREE.Texture> | null = null;

  private town: { x: number; y: number };
  private townDrop = new THREE.Vector2();
  private res: Record<ResourceType, number> = { wood: 0, food: 120, gold: 0 };
  private econ: EconomyHooks;

  private moveMarker: THREE.Mesh;
  private markerT = -1;

  // input
  private keys = new Set<string>();
  private pointerNdc = new THREE.Vector2(2, 2);
  private lastNdc = new THREE.Vector2();
  private downPos = new THREE.Vector2();
  private downButton = -1;
  private panning = false;
  private moved = false;
  private boxSelecting = false;
  private boxEl: HTMLDivElement;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene.background = this.makeSky();
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 22, 48);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 90);
    this.setupLights();

    this.terrain = new Terrain(this.land);
    this.scene.add(this.terrain.group);

    this.fog = new FogOfWar(this.land.width, this.land.height);
    this.fog.attachToObject(this.terrain.group);

    this.town = this.land.townCell;
    const tcHeight = this.terrain.heightAt(this.town.x + 0.5, this.town.y + 0.5);
    const townMesh = buildTownCenter(tcHeight);
    townMesh.position.x = this.town.x + 0.5;
    townMesh.position.z = this.town.y + 0.5;
    this.fog.attachToObject(townMesh);
    this.scene.add(townMesh);

    const drop = this.findOpenStart(this.town.x, this.town.y + 3);
    this.townDrop.set(drop.x + 0.5, drop.y + 0.5);

    this.econ = {
      dropPos: () => this.townDrop,
      deposit: (t, a) => {
        this.res[t] += a;
      },
    };

    // Starting villagers around the drop point.
    for (let i = 0; i < 3; i++) {
      const s = this.findOpenStart(drop.x + i - 1, drop.y + 1);
      this.addVillager(new Villager(this.terrain, s.x + 0.5, s.y + 0.5, this.econ));
    }

    this.rig = new CameraRig(this.camera, this.land.width, this.land.height);
    this.rig.focusOn(
      (this.town.x + 0.5 + this.townDrop.x) / 2,
      (this.town.y + 0.5 + this.townDrop.y) / 2
    );
    this.refreshFog();

    this.moveMarker = this.makeMoveMarker();
    this.scene.add(this.moveMarker);

    this.boxEl = document.createElement('div');
    this.boxEl.className = 'select-box';
    this.container.appendChild(this.boxEl);

    this.bindEvents();
    this.bindHud();
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());

    void this.initSprites();
  }

  // ---- setup ----

  private makeSky(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#' + SKY_TOP.toString(16).padStart(6, '0'));
    grad.addColorStop(1, '#' + SKY_HORIZON.toString(16).padStart(6, '0'));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight(SKY_TOP, 0x4a5a3a, 0.7));
    const cx = this.land.width / 2;
    const cz = this.land.height / 2;
    const sun = new THREE.DirectionalLight(SUN_COLOR, 2.5);
    sun.position.set(cx + 46, 80, cz - 34);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 300;
    const s = 78;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  private makeMoveMarker(): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.42, 32),
      new THREE.MeshBasicMaterial({
        color: 0x6ecfff,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    return m;
  }

  private findOpenStart(cx: number, cy: number): { x: number; y: number } {
    const ok = (x: number, y: number): boolean => {
      if (!this.land.isWalkable(x, y)) return false;
      if (this.land.biomeAt(x, y) !== Biome.Grass) return false;
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) if (!this.land.isWalkable(nx, ny)) return false;
      }
      return true;
    };
    for (let r = 0; r < 28; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (ok(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
        }
      }
    }
    return { x: cx, y: cy };
  }

  // ---- sprites & resources ----

  private async initSprites(): Promise<void> {
    let tex: Record<SpriteKey, THREE.Texture>;
    try {
      tex = await loadSpriteTextures();
    } catch {
      return;
    }
    this.tex = tex;

    for (const v of this.villagers) v.setSprite(tex.villager);
    // Refresh raycast map now that sprite meshes were added.
    this.villagerByObj.clear();
    for (const v of this.villagers) this.villagerByObj.set(v.group, v);

    const rng = this.makeRng(99);

    // Trees → wood, on forest cells.
    const forest = this.cellsOfBiome(Biome.Forest);
    forest.sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(180, forest.length); i++) {
      const t = forest[i];
      const wx = t.x + 0.5 + (rng() - 0.5) * 0.7;
      const wz = t.y + 0.5 + (rng() - 0.5) * 0.7;
      this.addNode('wood', tex.tree, wx, wz, 3.3, 120, 1.5);
    }

    // A small grove of trees close to town so wood is gatherable from the start.
    const woodNear = this.grassRing(this.town.x, this.town.y, 11, 16);
    woodNear.sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(12, woodNear.length); i++) {
      const t = woodNear[i];
      this.addNode('wood', tex.tree, t.x + 0.5 + (rng() - 0.5) * 0.5, t.y + 0.5 + (rng() - 0.5) * 0.5, 3.0, 100, 1.4);
    }

    // Berry bushes → food, in a patch near the town.
    const near = this.grassRing(this.town.x, this.town.y, 5, 10);
    near.sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(16, near.length); i++) {
      const t = near[i];
      this.addNode('food', tex.berries, t.x + 0.5, t.y + 0.5, 1.05, 160, 1.1);
    }

    // Gold ore → gold, in two clusters away from the town.
    const far = this.grassRing(this.town.x, this.town.y, 18, 30);
    far.sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(10, far.length); i++) {
      const t = far[i];
      this.addNode('gold', tex.gold, t.x + 0.5, t.y + 0.5, 1.15, 220, 1.2);
    }

    // Decorative wandering sheep.
    const open = this.grassRing(this.town.x, this.town.y, 8, 26);
    open.sort(() => rng() - 0.5);
    for (let i = 0; i < Math.min(10, open.length); i++) {
      const t = open[i];
      const bb = new Billboard(tex.sheep, 1.0, { yOffset: -0.05, shadowScale: 1.3 });
      const wx = t.x + 0.5;
      const wz = t.y + 0.5;
      bb.setPosition(wx, this.terrain.heightAt(wx, wz), wz);
      this.scene.add(bb.group);
      this.billboards.push(bb);
      this.sheep.push({ bb, pos: new THREE.Vector2(wx, wz), target: null, wait: rng() * 3 });
      bb.group.visible = this.fog.isVisible(wx, wz);
    }
  }

  private addNode(
    type: ResourceType,
    texture: THREE.Texture,
    wx: number,
    wz: number,
    height: number,
    amount: number,
    shadowScale: number
  ): void {
    const bb = new Billboard(texture, height, { yOffset: -0.06 * height, shadowScale });
    bb.setPosition(wx, this.terrain.heightAt(wx, wz), wz);
    this.scene.add(bb.group);
    this.billboards.push(bb);
    const node = new ResourceNode(type, wx, wz, amount, bb.group);
    this.nodes.push(node);
    this.nodeByObj.set(bb.group, node);
    bb.group.visible = this.fog.isExplored(wx, wz);
  }

  private cellsOfBiome(b: Biome): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let y = 2; y < this.land.height - 2; y++) {
      for (let x = 2; x < this.land.width - 2; x++) {
        if (this.land.biome[y * this.land.width + x] === b) out.push({ x, y });
      }
    }
    return out;
  }

  private grassRing(cx: number, cy: number, rMin: number, rMax: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let y = 2; y < this.land.height - 2; y++) {
      for (let x = 2; x < this.land.width - 2; x++) {
        if (this.land.biome[y * this.land.width + x] !== Biome.Grass) continue;
        if (!this.land.isWalkable(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d >= rMin && d <= rMax) out.push({ x, y });
      }
    }
    return out;
  }

  private makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }

  // ---- input ----

  private bindEvents(): void {
    const el = this.renderer.domElement;
    window.addEventListener('resize', () => this.resize());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  private bindHud(): void {
    document.getElementById('train-btn')?.addEventListener('click', () => this.trainVillager());
  }

  private toNdc(e: { clientX: number; clientY: number }): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.rig.zoom(this.toNdc(e), e.deltaY);
  }

  private onPointerDown(e: PointerEvent): void {
    this.downButton = e.button;
    this.downPos.set(e.clientX, e.clientY);
    this.lastNdc.copy(this.toNdc(e));
    this.moved = false;

    const space = this.keys.has(' ');
    if (e.button === 1 || (e.button === 0 && space)) this.panning = true;
    else if (e.button === 0) this.boxSelecting = true;
  }

  private onPointerMove(e: PointerEvent): void {
    const ndc = this.toNdc(e);
    this.pointerNdc.copy(ndc);
    if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 14) this.moved = true;

    if (!this.panning && this.downButton === 2 && this.moved) this.panning = true;
    if (this.panning) {
      this.boxSelecting = false;
      this.boxEl.style.display = 'none';
      this.rig.panByGround(this.lastNdc, ndc);
    } else if (this.boxSelecting && this.moved) {
      this.updateBox(e.clientX, e.clientY);
    }
    this.lastNdc.copy(ndc);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.boxSelecting && this.moved) {
      this.doBoxSelect(e.clientX, e.clientY);
    } else if (!this.panning && !this.moved) {
      if (e.button === 0) this.selectAt(e);
      else if (e.button === 2) this.commandAt(this.toNdc(e));
    }
    this.boxEl.style.display = 'none';
    this.boxSelecting = false;
    this.panning = false;
    this.downButton = -1;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === 't' && !e.repeat) this.trainVillager();
    if (k === 'a' && !e.repeat) this.setSelection([...this.villagers]);
  }

  private updateBox(curX: number, curY: number): void {
    const x = Math.min(this.downPos.x, curX);
    const y = Math.min(this.downPos.y, curY);
    const w = Math.abs(curX - this.downPos.x);
    const h = Math.abs(curY - this.downPos.y);
    this.boxEl.style.display = 'block';
    this.boxEl.style.left = `${x}px`;
    this.boxEl.style.top = `${y}px`;
    this.boxEl.style.width = `${w}px`;
    this.boxEl.style.height = `${h}px`;
  }

  private projectToScreen(v: Villager): { x: number; y: number; visible: boolean } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = v.worldPosition().add(new THREE.Vector3(0, 0.6, 0)).project(this.camera);
    return {
      x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
      visible: p.z < 1,
    };
  }

  private setSelection(vs: Villager[]): void {
    for (const v of this.villagers) v.setSelected(false);
    this.selected.clear();
    for (const v of vs) {
      v.setSelected(true);
      this.selected.add(v);
    }
  }

  private selectAt(e: PointerEvent): void {
    // Prefer a precise sprite hit; fall back to nearest projected screen point.
    const hit = this.pickVillager(this.toNdc(e));
    if (hit) {
      this.setSelection([hit]);
      return;
    }
    let best: Villager | null = null;
    let bestD = 60;
    for (const v of this.villagers) {
      const s = this.projectToScreen(v);
      if (!s.visible) continue;
      const d = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    this.setSelection(best ? [best] : []);
  }

  private doBoxSelect(curX: number, curY: number): void {
    const x0 = Math.min(this.downPos.x, curX);
    const x1 = Math.max(this.downPos.x, curX);
    const y0 = Math.min(this.downPos.y, curY);
    const y1 = Math.max(this.downPos.y, curY);
    const picked: Villager[] = [];
    for (const v of this.villagers) {
      const s = this.projectToScreen(v);
      if (s.visible && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) picked.push(v);
    }
    this.setSelection(picked);
  }

  private commandAt(ndc: THREE.Vector2): void {
    if (this.selected.size === 0) return;
    const sel = [...this.selected];

    // If the player clicked a resource sprite, assign a gather job.
    const node = this.pickNode(ndc);
    if (node && this.fog.isExplored(node.pos.x, node.pos.y)) {
      for (const v of sel) v.gather(node);
      return;
    }

    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.terrain.ground, false)[0];
    if (!hit) return;
    const point = new THREE.Vector2(hit.point.x, hit.point.z);
    if (!this.land.isWalkable(point.x, point.y)) return;
    const cols = Math.ceil(Math.sqrt(sel.length));
    sel.forEach((v, i) => {
      const gx = i % cols;
      const gz = Math.floor(i / cols);
      const ox = (gx - (cols - 1) / 2) * 1.2;
      const oz = (gz - (cols - 1) / 2) * 1.2;
      v.moveTo(point.x + ox, point.y + oz);
    });
    this.moveMarker.position.set(point.x, this.terrain.heightAt(point.x, point.y) + 0.06, point.y);
    this.moveMarker.visible = true;
    this.markerT = 0;
  }

  /** Pick the resource node whose sprite is under the cursor (precise). */
  private pickNode(ndc: THREE.Vector2): ResourceNode | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const objs = this.nodes.filter((n) => n.alive).map((n) => n.obj);
    const hits = ray.intersectObjects(objs, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const n = this.nodeByObj.get(o);
        if (n && n.alive) return n;
        o = o.parent;
      }
    }
    return null;
  }

  private trainVillager(): void {
    if (!this.tex || this.res.food < TRAIN_COST) return;
    this.res.food -= TRAIN_COST;
    const s = this.findOpenStart(Math.round(this.townDrop.x), Math.round(this.townDrop.y) + 1);
    const v = new Villager(this.terrain, s.x + 0.5, s.y + 0.5, this.econ);
    v.setSprite(this.tex.villager);
    this.addVillager(v);
  }

  private addVillager(v: Villager): void {
    this.villagers.push(v);
    this.scene.add(v.group);
    this.villagerByObj.set(v.group, v);
  }

  /** Pick the villager whose sprite is under the cursor. */
  private pickVillager(ndc: THREE.Vector2): Villager | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const groups = this.villagers.filter((v) => v.group.visible).map((v) => v.group);
    const hits = ray.intersectObjects(groups, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const v = this.villagerByObj.get(o);
        if (v) return v;
        o = o.parent;
      }
    }
    return null;
  }

  // ---- HUD ----

  private setText(id: string, text: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  private updateHud(): void {
    this.setText('res-wood', String(Math.floor(this.res.wood)));
    this.setText('res-food', String(Math.floor(this.res.food)));
    this.setText('res-gold', String(Math.floor(this.res.gold)));
    this.setText('res-pop', String(this.villagers.length));

    const panel = document.getElementById('selection-panel');
    const name = document.getElementById('unit-name');
    const status = document.getElementById('unit-status');
    if (!panel || !name || !status) return;

    if (this.selected.size === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    const first = this.selected.values().next().value as Villager;
    name.textContent = this.selected.size > 1 ? `Villagers ×${this.selected.size}` : 'Villager';
    status.textContent = first.status;
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- loop ----

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;

    for (const v of this.villagers) v.update(dt);
    if (this.downButton === -1) this.rig.edgeScroll(dt, this.pointerNdc.x, this.pointerNdc.y);
    this.updateMoveMarker(dt);

    this.refreshFog();
    this.cullDepletedNodes();
    this.syncHiddenProps();
    this.updateSheep(dt);

    const camPos = this.camera.position;
    for (const v of this.villagers) if (v.group.visible) v.face(camPos);
    for (const bb of this.billboards) bb.face(camPos);

    this.terrain.update(time);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  }

  private refreshFog(): void {
    this.fog.clearVisibility();
    this.fog.reveal(this.town.x + 0.5, this.town.y + 0.5, TOWN_VISION);
    for (const v of this.villagers) {
      this.fog.reveal(v.pos.x, v.pos.y, UNIT_VISION);
    }
    this.fog.upload();
  }

  private syncHiddenProps(): void {
    for (const n of this.nodes) {
      if (!n.alive) continue;
      n.obj.visible = this.fog.isExplored(n.pos.x, n.pos.y);
    }
    for (const s of this.sheep) {
      s.bb.group.visible = this.fog.isVisible(s.pos.x, s.pos.y);
    }
  }

  private cullDepletedNodes(): void {
    for (const n of this.nodes) {
      if (!n.alive && n.obj.parent) {
        this.scene.remove(n.obj);
      }
    }
  }

  private updateSheep(dt: number): void {
    const speed = 0.7;
    for (const s of this.sheep) {
      if (s.target) {
        const dir = s.target.clone().sub(s.pos);
        const dist = dir.length();
        if (dist < 0.05) {
          s.target = null;
          s.wait = 1 + Math.random() * 3;
        } else {
          dir.normalize();
          s.pos.addScaledVector(dir, Math.min(speed * dt, dist));
        }
      } else {
        s.wait -= dt;
        if (s.wait <= 0) {
          const tx = s.pos.x + (Math.random() * 2 - 1) * 4;
          const tz = s.pos.y + (Math.random() * 2 - 1) * 4;
          if (this.land.isWalkable(tx, tz) && this.land.biomeAt(tx, tz) === Biome.Grass) {
            s.target = new THREE.Vector2(tx, tz);
          } else {
            s.wait = 0.5 + Math.random();
          }
        }
      }
      s.bb.setPosition(s.pos.x, this.terrain.heightAt(s.pos.x, s.pos.y), s.pos.y);
    }
  }

  private updateMoveMarker(dt: number): void {
    if (this.markerT < 0) return;
    this.markerT += dt;
    const t = this.markerT / 0.7;
    if (t >= 1) {
      this.moveMarker.visible = false;
      this.markerT = -1;
      return;
    }
    const sc = 0.4 + t * 1.6;
    this.moveMarker.scale.set(sc, sc, 1);
    (this.moveMarker.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
  }
}
