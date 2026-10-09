import type { Stockpile, Unit } from '../core/types';
import type { Selection } from '../game/Selection';
import { BALANCE } from '../sim/balance';
import type { World } from '../sim/World';
import { formatCount, groupStatus, trainLabel, trainProgress, unitName } from './format';

/** Length of the train ring's circle (its `pathLength`). */
const RING = 100;

/**
 * Binds the existing DOM in index.html: #res-food/#res-wood/#res-gold/#res-pop,
 * #selection-panel (+ .hidden), #unit-name, #unit-status, .unit-portrait, #train-btn
 * (.train-sub label, .train-ring-fill progress ring, .training while queued).
 * Updates from world.events and selection changes. Owned by the HUD lane.
 * Public surface FROZEN: constructor, update.
 */
export class Hud {
  private readonly el = {
    food: byId('res-food'),
    wood: byId('res-wood'),
    gold: byId('res-gold'),
    pop: byId('res-pop'),
    panel: byId('selection-panel'),
    name: byId('unit-name'),
    status: byId('unit-status'),
    train: byId('train-btn'),
  };
  private readonly trainSub: HTMLElement | null;
  private readonly trainRing: SVGElement | null;
  private readonly portrait: HTMLElement | null;
  private dimmed: boolean | null = null;
  private ringOffset = '';

  constructor(
    readonly world: World,
    readonly selection: Selection,
    readonly onTrain: () => void
  ) {
    this.trainSub = this.el.train?.querySelector<HTMLElement>('.train-sub') ?? null;
    this.trainRing = this.el.train?.querySelector<SVGElement>('.train-ring-fill') ?? null;
    this.portrait = this.el.panel?.querySelector<HTMLElement>('.unit-portrait') ?? null;
    this.setStock(world.stock, world.pop);
    world.events.on('stockpile', (e) => this.setStock(e.stock, e.pop));
    world.events.on('rejected', (e) => {
      if (e.reason === 'insufficient-food' || e.reason === 'pop-cap') this.flashTrain();
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

  private setStock(stock: Stockpile, pop: number): void {
    setText(this.el.food, formatCount(stock.food));
    setText(this.el.wood, formatCount(stock.wood));
    setText(this.el.gold, formatCount(stock.gold));
    setText(this.el.pop, `${pop}/${BALANCE.popCap}`);
  }

  private updateSelection(): void {
    const units: Unit[] = [];
    for (const id of this.selection.ids) {
      const u = this.world.units.get(id);
      if (u) units.push(u);
    }
    this.el.panel?.classList.toggle('hidden', units.length === 0);
    if (!units.length) return;
    setText(this.el.name, unitName(units.length));
    setText(this.el.status, groupStatus(units, BALANCE.carryCap));
    const count = units.length > 1 ? String(units.length) : '';
    if (this.portrait && this.portrait.dataset.count !== count) this.portrait.dataset.count = count;
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
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}
