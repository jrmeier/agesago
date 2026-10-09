import { BUILDINGS, FARM_FOOD } from '../core/buildings';
import type { Building, BuildingKind, ResourceType, Stockpile, Unit } from '../core/types';
import type { Selection } from '../game/Selection';
import { BALANCE } from '../sim/balance';
import type { World } from '../sim/World';
import {
  BUILD_HOTKEYS,
  buildableKinds,
  buildingRole,
  canAfford,
  constructionLabel,
  costEntries,
  formatCost,
  keyLabel,
  popLabel,
} from './build';
import { formatCount, groupStatus, portraitKind, selectionName, showExplore, trainLabel, trainProgress } from './format';

/** Length of the train ring's circle (its `pathLength`). */
const RING = 100;
/** How long the "Need more houses" note stays up (ms). */
const POP_NOTE_MS = 2600;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Binds the existing DOM in index.html: #res-food/#res-wood/#res-gold/#res-stone/#res-pop
 * (pop shows "pop/popCap"; #pop-plaque flashes and #pop-note says "Need more houses" when
 * training hits the cap), #selection-panel (+ .hidden), #unit-name, #unit-status,
 * .unit-portrait (its <use> swaps between unit and building icons), #explore-btn (shown when
 * the selection can explore; Controls handles the click), #build-grid (one [data-build]
 * button per buildable kind, shown when villagers are selected; Controls handles clicks),
 * #build-progress / #cancel-build-btn (building panel for a selected foundation; Controls
 * handles the click), #train-btn (.train-sub label, .train-ring-fill progress ring,
 * .training while queued). Updates from world.events and selection changes.
 * Owned by the HUD lane. Public surface FROZEN: constructor, update.
 */
export class Hud {
  private readonly el = {
    food: byId('res-food'),
    wood: byId('res-wood'),
    gold: byId('res-gold'),
    stone: byId('res-stone'),
    pop: byId('res-pop'),
    popPlaque: byId('pop-plaque'),
    popNote: byId('pop-note'),
    panel: byId('selection-panel'),
    name: byId('unit-name'),
    status: byId('unit-status'),
    train: byId('train-btn'),
    explore: byId('explore-btn'),
    grid: byId('build-grid'),
    progress: byId('build-progress'),
    cancel: byId('cancel-build-btn'),
  };
  private readonly trainSub: HTMLElement | null;
  private readonly trainRing: SVGElement | null;
  private readonly portrait: HTMLElement | null;
  private readonly portraitUse: SVGUseElement | null;
  private readonly progressFill: HTMLElement | null;
  private readonly buildButtons = new Map<BuildingKind, HTMLButtonElement>();
  private portraitShown = '#i-villager';
  private dimmed: boolean | null = null;
  private ringOffset = '';
  private affordKey = '';
  private popNoteTimer = 0;

  constructor(
    readonly world: World,
    readonly selection: Selection,
    readonly onTrain: () => void
  ) {
    this.trainSub = this.el.train?.querySelector<HTMLElement>('.train-sub') ?? null;
    this.trainRing = this.el.train?.querySelector<SVGElement>('.train-ring-fill') ?? null;
    this.portrait = this.el.panel?.querySelector<HTMLElement>('.unit-portrait') ?? null;
    this.portraitUse = this.portrait?.querySelector<SVGUseElement>('use') ?? null;
    this.progressFill = this.el.progress?.querySelector<HTMLElement>('.build-progress-fill') ?? null;
    this.buildGrid();
    this.setStock(world.stock, world.pop, world.popCap);
    world.events.on('stockpile', (e) => this.setStock(e.stock, e.pop, e.popCap));
    world.events.on('rejected', (e) => {
      if (e.reason === 'insufficient-food' || e.reason === 'pop-cap') this.flashTrain();
      if (e.reason === 'pop-cap') this.flashPop();
    });
    selection.onChange(() => this.updateSelection());
    this.el.train?.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.onTrain();
    });
    this.update();
  }

  /** Per-frame refresh for things not driven by events (e.g. selected unit status). */
  update(): void {
    this.updateSelection();
    this.updateTrain();
  }

  private setStock(stock: Stockpile, pop: number, popCap: number): void {
    setText(this.el.food, formatCount(stock.food));
    setText(this.el.wood, formatCount(stock.wood));
    setText(this.el.gold, formatCount(stock.gold));
    setText(this.el.stone, formatCount(stock.stone ?? 0));
    setText(this.el.pop, popLabel(pop, popCap));
    this.el.popPlaque?.classList.toggle('capped', pop >= popCap);
  }

  /** One button per buildable kind: icon, name, cost (with resource icons) and hotkey. */
  private buildGrid(): void {
    const grid = this.el.grid;
    if (!grid) return;
    grid.replaceChildren();
    for (const kind of buildableKinds()) {
      const spec = BUILDINGS[kind];
      const key = keyLabel(BUILD_HOTKEYS[kind]);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'build-btn';
      btn.dataset.build = kind;
      btn.title = `${spec.name} — ${formatCost(spec.cost)}${key ? ` (${key})` : ''}`;
      btn.setAttribute('aria-label', btn.title);
      btn.append(icon(`#i-b-${kind}`, 'build-icon'));
      const name = document.createElement('span');
      name.className = 'build-name';
      name.textContent = spec.name;
      btn.append(name);
      const cost = document.createElement('span');
      cost.className = 'build-cost';
      for (const e of costEntries(spec.cost)) {
        const part = document.createElement('span');
        part.className = 'build-cost-part';
        part.append(icon(`#i-${e.type}`, 'cost-icon'), String(e.amount));
        cost.append(part);
      }
      btn.append(cost);
      if (key) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        btn.append(kbd);
      }
      grid.append(btn);
      this.buildButtons.set(kind, btn);
    }
  }

  private updateSelection(): void {
    const units: Unit[] = [];
    let building: Building | undefined;
    for (const id of this.selection.ids) {
      const u = this.world.units.get(id);
      if (u) units.push(u);
      else building ??= this.world.buildings.get(id);
    }
    const target = units.length ? 'units' : building ? 'building' : null;
    this.el.panel?.classList.toggle('hidden', target === null);
    this.el.panel?.classList.toggle('building-mode', target === 'building');
    this.updateExplore(units);
    const villagers = units.some((u) => u.kind === 'villager');
    if (this.el.grid && this.el.grid.hidden === villagers) this.el.grid.hidden = !villagers;
    if (villagers) this.updateAffordable();
    this.updateBuilding(target === 'building' ? building : undefined);
    if (target === 'units') {
      const kinds = units.map((u) => u.kind);
      setText(this.el.name, selectionName(kinds));
      setText(this.el.status, groupStatus(units, BALANCE.carryCap));
      this.setPortrait(`#i-${portraitKind(kinds)}`, units.length > 1 ? String(units.length) : '');
    }
  }

  private updateBuilding(b: Building | undefined): void {
    const foundation = !!b && !b.complete;
    if (this.el.progress && this.el.progress.hidden === foundation) this.el.progress.hidden = !foundation;
    if (this.el.cancel && this.el.cancel.hidden === foundation) this.el.cancel.hidden = !foundation;
    if (!b) return;
    setText(this.el.name, BUILDINGS[b.kind].name);
    this.setPortrait(`#i-b-${b.kind}`, '');
    if (foundation) {
      setText(this.el.status, constructionLabel(b.buildProgress));
      const w = `${(Math.min(1, Math.max(0, b.buildProgress)) * 100).toFixed(1)}%`;
      if (this.progressFill && this.progressFill.style.width !== w) this.progressFill.style.width = w;
    } else if (b.kind === 'townCenter') {
      setText(this.el.status, b.queue > 0 ? trainLabel(b.queue, b.progress, BALANCE.trainTime, BALANCE.trainCost.food, true) : buildingRole(b.kind));
    } else {
      setText(this.el.status, buildingRole(b.kind, b.food, FARM_FOOD));
    }
  }

  private setPortrait(href: string, count: string): void {
    if (this.portrait && this.portrait.dataset.count !== count) this.portrait.dataset.count = count;
    if (href !== this.portraitShown && this.portraitUse) {
      this.portraitShown = href;
      this.portraitUse.setAttribute('href', href);
    }
  }

  /** Grey out build buttons the stockpile can't pay for (only touches the DOM when that changes). */
  private updateAffordable(): void {
    const stock = this.world.stock;
    let key = '';
    for (const kind of this.buildButtons.keys()) key += canAfford(BUILDINGS[kind].cost, stock) ? '1' : '0';
    if (key === this.affordKey) return;
    this.affordKey = key;
    let i = 0;
    for (const [kind, btn] of this.buildButtons) {
      const ok = key[i++] === '1';
      btn.classList.toggle('unaffordable', !ok);
      btn.setAttribute('aria-disabled', String(!ok));
      for (const part of btn.querySelectorAll<HTMLElement>('.build-cost-part')) {
        const type = part.querySelector('use')?.getAttribute('href')?.slice(3) as ResourceType | undefined;
        const need = type ? (BUILDINGS[kind].cost[type] ?? 0) : 0;
        part.classList.toggle('short', !!type && stock[type] < need);
      }
    }
  }

  private updateExplore(units: readonly Unit[]): void {
    const btn = this.el.explore;
    if (!btn) return;
    const show = showExplore(units);
    if (btn.hidden === show) btn.hidden = !show;
    const pressed = String(show && units.every((u) => u.state === 'exploring'));
    if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
  }

  private updateTrain(): void {
    const btn = this.el.train;
    if (!btn) return;
    const tc = this.world.townCenter;
    const cost = BALANCE.trainCost.food;
    const touch = document.body.classList.contains('touch');
    setText(this.trainSub, trainLabel(tc.queue, tc.progress, BALANCE.trainTime, cost, touch));
    const p = trainProgress(tc.queue, tc.progress, BALANCE.trainTime);
    const offset = (RING * (1 - p)).toFixed(1);
    if (this.trainRing && offset !== this.ringOffset) {
      this.ringOffset = offset;
      this.trainRing.style.strokeDashoffset = offset;
    }
    btn.classList.toggle('training', tc.queue > 0);
    const dim = this.world.stock.food < cost;
    if (dim === this.dimmed) return;
    this.dimmed = dim;
    btn.classList.toggle('disabled', dim);
    btn.setAttribute('aria-disabled', String(dim));
  }

  private flashTrain(): void {
    this.el.train?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }],
      { duration: 240, iterations: 1 }
    );
  }

  /** Pop cap reached: pulse the pop plaque red and show "Need more houses" under it. */
  private flashPop(): void {
    this.el.popPlaque?.animate(
      [
        { boxShadow: '0 0 0 0 rgba(220, 60, 40, 0)' },
        { boxShadow: '0 0 0 3px rgba(220, 60, 40, 0.9)', offset: 0.3 },
        { boxShadow: '0 0 0 0 rgba(220, 60, 40, 0)' },
      ],
      { duration: 700, iterations: 2 }
    );
    const note = this.el.popNote;
    if (!note) return;
    note.textContent = 'Need more houses';
    note.classList.add('show');
    clearTimeout(this.popNoteTimer);
    this.popNoteTimer = window.setTimeout(() => note.classList.remove('show'), POP_NOTE_MS);
  }
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function icon(href: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  svg.append(use);
  return svg;
}
