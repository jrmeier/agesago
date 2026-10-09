import type { Stockpile, Unit } from '../core/types';
import type { Selection } from '../game/Selection';
import { BALANCE } from '../sim/balance';
import type { World } from '../sim/World';
import { groupStatus, trainLabel, unitName } from './format';

/**
 * Binds the existing DOM in index.html: #res-food/#res-wood/#res-gold/#res-pop,
 * #selection-panel (+ .hidden), #unit-name, #unit-status, #train-btn.
 * Updates from world.events and selection changes. Owned by the Controls lane (T6).
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
  private dimmed: boolean | null = null;

  constructor(
    readonly world: World,
    readonly selection: Selection,
    readonly onTrain: () => void
  ) {
    this.trainSub = this.el.train?.querySelector('span') ?? null;
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
    setText(this.el.food, String(Math.floor(stock.food)));
    setText(this.el.wood, String(Math.floor(stock.wood)));
    setText(this.el.gold, String(Math.floor(stock.gold)));
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
  }

  private updateTrain(): void {
    const btn = this.el.train;
    if (!btn) return;
    const tc = this.world.townCenter;
    const cost = BALANCE.trainCost.food;
    setText(this.trainSub, trainLabel(tc.queue, tc.progress, BALANCE.trainTime, cost));
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
