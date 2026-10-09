import type { CameraRig, CameraMode } from '../camera/CameraRig';
import type { NodeKind } from '../core/types';
import { focusNextScout } from '../input/scouts';
import type { World } from '../sim/World';
import { nodeAlpha, paintFog } from './fog';
import { exploredLabel } from './format';
import { footprintKey, mapToWorld, renderTerrain, worldToMap, type MapBox } from './minimapMath';
import { takePings } from './pings';

/** Terrain raster resolution in pixels per world unit. */
const TERRAIN_PX_PER_UNIT = 2;
/** Seconds between redraws of the unit / resource layer (~5 Hz). */
const DYNAMIC_INTERVAL = 0.2;
/** Seconds between "Explored NN%" refreshes (~2 Hz). */
const EXPLORED_INTERVAL = 0.5;

const NODE_COLOR: Record<NodeKind, string> = {
  tree: '#24401c',
  berry: '#c8323c',
  gold: '#f4c638',
  stone: '#c9c3b4',
};
const PLAYER = '#3fa0ff';
const PLAYER_EDGE = '#0b2340';
const SCOUT_RIM = '#f6ead0';
const VIEW = 'rgba(255, 246, 214, 0.95)';

/**
 * Framed minimap: terrain painted once from the Heightfield, a fog-of-war layer (one pixel
 * per visibility cell, repainted only when world.visibility.version changes), resources /
 * units / buildings in owner colours redrawn at ~5 Hz (enemy units only where visible, enemy
 * buildings once seen), alert pings (ui/pings.ts) as CSS rings, and the RTS view footprint whenever it
 * moves. Below the chart: an "Explored NN%" readout (~2 Hz) and a find-scout button.
 * Click, tap or drag to move the camera; input never reaches the game canvas. Hidden in
 * first person. Owned by the HUD lane.
 */
export class Minimap {
  readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly fog: HTMLCanvasElement;
  private readonly fogPixels: ImageData | null;
  private readonly units: HTMLCanvasElement;
  private readonly view: HTMLCanvasElement;
  private readonly toggle: HTMLButtonElement;
  private readonly explored: HTMLSpanElement;
  private readonly box: MapBox;
  private readonly offMode: () => void;
  private lastDynamic = -Infinity;
  private lastExplored = -Infinity;
  private fogVersion = -1;
  private exploredVersion = -1;
  private lastView = '';
  private cssW = 0;
  /** Frame width from the ResizeObserver; null = measure on next update. */
  private observedW: number | null = null;
  private readonly resizer: ResizeObserver | null;
  private dragId: number | null = null;
  private collapsed = false;
  private mode: CameraMode;
  /** Enemy buildings the local player has seen at least once. */
  private readonly seenBuildings = new Set<number>();
  private readonly colorCache = new Map<number, [string, string]>();

  constructor(
    container: HTMLElement,
    readonly world: World,
    readonly rig: CameraRig
  ) {
    const hf = world.hf;
    this.box = { w: 1, h: 1, mapW: hf.width, mapD: hf.depth };

    this.root = el('div', 'minimap');
    this.root.dataset.hudInteractive = '';
    this.frame = el('div', 'minimap-frame');
    this.frame.style.aspectRatio = `${hf.width} / ${hf.depth}`;
    this.frame.setAttribute('role', 'img');
    this.frame.setAttribute('aria-label', 'Map — tap or drag to move the view');

    const terrain = el('canvas', 'minimap-layer minimap-terrain');
    terrain.width = Math.round(hf.width * TERRAIN_PX_PER_UNIT);
    terrain.height = Math.round(hf.depth * TERRAIN_PX_PER_UNIT);
    terrain.getContext('2d')?.putImageData(new ImageData(renderTerrain(hf, terrain.width, terrain.height), terrain.width), 0, 0);
    const vis = world.visibility;
    this.fog = el('canvas', 'minimap-layer minimap-fog');
    this.fog.width = vis.cols;
    this.fog.height = vis.rows;
    this.fogPixels = typeof ImageData === 'undefined' ? null : new ImageData(vis.cols, vis.rows);
    this.units = el('canvas', 'minimap-layer');
    this.view = el('canvas', 'minimap-layer');
    this.frame.append(terrain, this.fog, this.units, this.view);

    const bar = el('div', 'minimap-bar');
    this.explored = el('span', 'minimap-explored');
    this.explored.setAttribute('aria-live', 'off');
    const scout = el('button', 'minimap-scout');
    scout.type = 'button';
    scout.title = 'Find scout (. or Home)';
    scout.setAttribute('aria-label', 'Find scout');
    scout.innerHTML = '<svg aria-hidden="true"><use href="#i-scout"></use></svg>';
    scout.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      focusNextScout(world, rig);
    });
    bar.append(this.explored, scout);

    this.toggle = el('button', 'minimap-toggle');
    this.toggle.type = 'button';
    this.toggle.setAttribute('aria-label', 'Hide map');
    this.toggle.setAttribute('aria-expanded', 'true');
    this.toggle.innerHTML = '<svg aria-hidden="true"><use href="#i-map"></use></svg>';
    this.toggle.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.setCollapsed(!this.collapsed);
    });

    this.root.append(this.frame, bar, this.toggle);
    container.append(this.root);

    this.frame.addEventListener('pointerdown', this.onDown);
    this.frame.addEventListener('pointermove', this.onMove);
    this.frame.addEventListener('pointerup', this.onUp);
    this.frame.addEventListener('pointercancel', this.onUp);
    this.root.addEventListener('contextmenu', stop);
    this.root.addEventListener('wheel', stop, { passive: false });

    this.resizer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            this.observedW = this.frame.clientWidth;
          });
    this.resizer?.observe(this.frame);

    this.mode = rig.mode;
    this.offMode = rig.onModeChange((m) => {
      this.mode = m;
      this.syncVisibility();
    });
    this.setCollapsed(false);
  }

  /** Call every frame with elapsed seconds; redraws layers as needed. */
  update(time: number): void {
    this.drawPings();
    if (this.mode !== 'rts' || this.collapsed) return;
    const version = this.world.visibility.version;
    if (version !== this.fogVersion) {
      this.fogVersion = version;
      this.drawFog();
    }
    if (version !== this.exploredVersion && time - this.lastExplored >= EXPLORED_INTERVAL) {
      this.lastExplored = time;
      this.exploredVersion = version;
      const text = exploredLabel(this.world.visibility.exploredFraction);
      if (this.explored.textContent !== text) this.explored.textContent = text;
    }
    const resized = this.fit();
    if (resized || time - this.lastDynamic >= DYNAMIC_INTERVAL) {
      this.lastDynamic = time;
      this.drawUnits();
    }
    const quad = this.rig.viewFootprint();
    const key = footprintKey(quad);
    if (resized || key !== this.lastView) {
      this.lastView = key;
      this.drawView(quad);
    }
  }

  dispose(): void {
    this.offMode();
    this.resizer?.disconnect();
    this.root.remove();
  }

  private setCollapsed(on: boolean): void {
    this.collapsed = on;
    this.root.classList.toggle('collapsed', on);
    this.toggle.setAttribute('aria-expanded', String(!on));
    this.toggle.setAttribute('aria-label', on ? 'Show map' : 'Hide map');
    this.lastView = '';
    this.lastDynamic = -Infinity;
    this.lastExplored = -Infinity;
    this.syncVisibility();
  }

  private syncVisibility(): void {
    this.root.classList.toggle('hidden', this.mode !== 'rts');
  }

  /** Match the overlay canvases' backing size to the frame (CSS px × DPR). Returns true if it changed. */
  private fit(): boolean {
    if (this.observedW === null) this.observedW = this.frame.clientWidth;
    const w = this.observedW;
    if (!w || w === this.cssW) return false;
    this.cssW = w;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round((w * dpr * this.box.mapD) / this.box.mapW);
    for (const c of [this.units, this.view]) {
      c.width = bw;
      c.height = bh;
    }
    this.box.w = bw;
    this.box.h = bh;
    return true;
  }

  private drawUnits(): void {
    const ctx = this.units.getContext('2d');
    if (!ctx) return;
    const { w, h } = this.box;
    const s = w / this.box.mapW;
    ctx.clearRect(0, 0, w, h);

    const r = Math.max(1, s * 0.55);
    const vis = this.world.visibility;
    for (const kind of ['tree', 'berry', 'gold', 'stone'] as const) {
      ctx.fillStyle = NODE_COLOR[kind];
      const size = kind === 'tree' ? r * 1.6 : r * 2.4;
      for (const n of this.world.nodes.values()) {
        if (n.kind !== kind || n.amount <= 0) continue;
        const a = nodeAlpha(vis.stateAt(n.pos.x, n.pos.z));
        if (!a) continue;
        ctx.globalAlpha = a;
        const p = worldToMap(n.pos, this.box);
        ctx.fillRect(p.u - size / 2, p.v - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;

    const local = this.world.localPlayer;
    // Enemy buildings appear once seen and stay (as last seen) while they stand.
    for (const b of this.world.buildings.values()) {
      if (b.owner !== local && !this.seenBuildings.has(b.id) && vis.isVisible(b.pos.x, b.pos.z)) this.seenBuildings.add(b.id);
    }
    const shown = (owner: number, x: number, z: number) => owner === local || vis.isVisible(x, z);

    ctx.lineWidth = Math.max(1, s * 0.3);
    for (const b of this.world.buildings.values()) {
      if (b.owner !== local && !this.seenBuildings.has(b.id)) continue;
      const [fill, edge] = this.colors(b.owner);
      ctx.fillStyle = fill;
      ctx.strokeStyle = edge;
      const p = worldToMap(b.pos, this.box);
      const half = Math.max(s * b.radius * 1.4, 4 * (w / 220));
      ctx.fillRect(p.u - half, p.v - half, half * 2, half * 2);
      ctx.strokeRect(p.u - half, p.v - half, half * 2, half * 2);
    }
    const ur = Math.max(1.6, s * 0.9);
    // One path per owner, so a few hundred dots cost a handful of fills.
    for (const owner of this.owners()) {
      const [fill, edge] = this.colors(owner);
      ctx.fillStyle = fill;
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(1, s * 0.3);
      ctx.beginPath();
      let any = false;
      for (const u of this.world.units.values()) {
        if (u.owner !== owner || u.kind === 'scout' || !shown(owner, u.pos.x, u.pos.z)) continue;
        const p = worldToMap(u.pos, this.box);
        ctx.moveTo(p.u + ur, p.v);
        ctx.arc(p.u, p.v, ur, 0, Math.PI * 2);
        any = true;
      }
      if (any) {
        ctx.fill();
        ctx.stroke();
      }

      // Scouts: a larger diamond with a pale rim, so they stand out on a big map.
      const d = ur * 2;
      ctx.beginPath();
      any = false;
      for (const u of this.world.units.values()) {
        if (u.owner !== owner || u.kind !== 'scout' || !shown(owner, u.pos.x, u.pos.z)) continue;
        const p = worldToMap(u.pos, this.box);
        ctx.moveTo(p.u, p.v - d);
        ctx.lineTo(p.u + d * 0.75, p.v);
        ctx.lineTo(p.u, p.v + d);
        ctx.lineTo(p.u - d * 0.75, p.v);
        ctx.closePath();
        any = true;
      }
      if (any) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1.5, s * 0.5);
        ctx.strokeStyle = SCOUT_RIM;
        ctx.stroke();
        ctx.fill();
      }
    }
  }

  /** Player ids, the local player last so its dots draw on top. */
  private owners(): number[] {
    const local = this.world.localPlayer;
    return [...this.world.players.keys()].filter((id) => id !== local).concat(local);
  }

  /** Fill and edge colours for a player's dots (the local player keeps the bright map blue). */
  private colors(owner: number): [string, string] {
    if (owner === this.world.localPlayer) return [PLAYER, PLAYER_EDGE];
    let c = this.colorCache.get(owner);
    if (!c) {
      const hex = this.world.players.get(owner)?.player.color ?? 0x999999;
      c = [cssHex(hex), '#1a0c06'];
      this.colorCache.set(owner, c);
    }
    return c;
  }

  /** Flash rings for alerts raised since the last frame (CSS-animated, removed when done). */
  private drawPings(): void {
    for (const ping of takePings(this.world)) {
      if (this.mode !== 'rts' || this.collapsed) continue;
      const el = document.createElement('span');
      el.className = `minimap-ping ping-${ping.kind}`;
      el.style.left = `${(ping.pos.x / this.box.mapW) * 100}%`;
      el.style.top = `${(ping.pos.z / this.box.mapD) * 100}%`;
      el.addEventListener('animationend', () => el.remove());
      this.frame.append(el);
      while (this.frame.querySelectorAll('.minimap-ping').length > 6) this.frame.querySelector('.minimap-ping')?.remove();
    }
  }

  /** Repaint the fog layer: one pixel per visibility cell, smoothed by the browser when scaled up. */
  private drawFog(): void {
    const ctx = this.fog.getContext('2d');
    if (!ctx || !this.fogPixels) return;
    paintFog(this.world.visibility.state, this.fogPixels.data);
    ctx.putImageData(this.fogPixels, 0, 0);
  }

  private drawView(quad: readonly { x: number; z: number }[]): void {
    const ctx = this.view.getContext('2d');
    if (!ctx) return;
    const { w, h } = this.box;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    quad.forEach((q, i) => {
      const p = worldToMap(q, this.box);
      if (i) ctx.lineTo(p.u, p.v);
      else ctx.moveTo(p.u, p.v);
    });
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20, 12, 4, 0.55)';
    ctx.lineWidth = Math.max(2, w / 110);
    ctx.stroke();
    ctx.strokeStyle = VIEW;
    ctx.lineWidth = Math.max(1, w / 220);
    ctx.stroke();
  }

  private moveCamera(e: PointerEvent): void {
    const r = this.frame.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const p = mapToWorld(e.clientX - r.left, e.clientY - r.top, { w: r.width, h: r.height, mapW: this.box.mapW, mapD: this.box.mapD });
    this.rig.focusOn(p);
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.dragId !== null) return;
    this.dragId = e.pointerId;
    this.frame.setPointerCapture?.(e.pointerId);
    this.moveCamera(e);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    e.preventDefault();
    e.stopPropagation();
    this.moveCamera(e);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    e.stopPropagation();
    this.dragId = null;
    if (this.frame.hasPointerCapture?.(e.pointerId)) this.frame.releasePointerCapture(e.pointerId);
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function cssHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

function stop(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}
