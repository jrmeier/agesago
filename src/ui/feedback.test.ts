import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRASS_ONLY, type ResourceType } from '../core/types';
import { World } from '../sim/World';
import { completeBuilding, layFoundation, removeBuilding } from '../sim/systems/build';
import { destroyBuilding } from '../sim/systems/combat';
import * as settings from '../game/settings';
import { Alerts } from './Alerts';
import { LootFloaters } from './LootFloaters';

class Element {
  children: Element[] = [];
  parent: Element | null = null;
  style = { opacity: '', transform: '' };
  textContent = '';
  className = '';
  classList = { add: vi.fn() };
  setAttribute() {}
  addEventListener() {}
  append(...els: Element[]) { for (const el of els) { el.parent = this; this.children.push(el); } }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  get isConnected() { return !!this.parent; }
}

function setup() {
  const w = new World({ width: 64, depth: 64, heightAt: () => 1, isWater: () => false,
    isWalkable: () => true, forestDensity: () => 0, ground: () => GRASS_ONLY },
  { townCenter: { x: 20, z: 20 }, villagers: [], scouts: [], nodes: [], props: [] });
  w.visibility.state.fill(2);
  return w;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => new Element(), createElementNS: () => new Element() });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('feedback event listeners', () => {
  it('does not alert for a deleted building, but batches actual destruction', () => {
    const w = setup(), root = new Element();
    const alerts = new Alerts(root as unknown as HTMLElement, w, () => {});
    const deleted = layFoundation(w, 'house', { x: 25, z: 20 }, 0, 1);
    removeBuilding(w, deleted);
    expect(root.children).toHaveLength(0);
    for (let i = 0; i < 4; i++) {
      const b = layFoundation(w, 'palisade', { x: 25 + i, z: 20 }, 0, 1);
      destroyBuilding(w, b);
    }
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children[1].textContent).toContain('destroyed');
    alerts.update(4);
    expect(root.children[1].children[1].textContent).toBe('3 buildings destroyed');
  });

  it('filters incomplete and foreign drops and shows depletion with a destroyed toast', () => {
    const w = setup(), root = new Element();
    new Alerts(root as unknown as HTMLElement, w, () => {});
    const pos = { x: 40, z: 40 };
    const drop = layFoundation(w, 'miningCamp', pos, 0, 1);
    const depleted = () => w.events.emit({ type: 'depleted', id: 999, kind: 'gold', pos });
    depleted(); expect(root.children).toHaveLength(0);
    completeBuilding(w, drop);
    drop.owner = 2; depleted(); expect(root.children).toHaveLength(0);
    drop.owner = 1; depleted(); depleted();
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children[1].textContent).toBe('Gold near your Mining Camp is exhausted');
    destroyBuilding(w, drop);
    expect(root.children).toHaveLength(2);
  });
});

describe('deposit floaters', () => {
  function fixture(tier: 'low' | 'high' = 'high') {
    const world = setup(), root = new Element();
    const floaters = new LootFloaters(root as unknown as HTMLElement, world, () => ({ x: 100, y: 100 }), tier);
    const deposit = (amount = 10, x = 20, resource: ResourceType = 'wood', owner = 1) =>
      world.events.emit({ type: 'deposited', owner, pos: { x, z: 20 }, resource, amount });
    return { world, root, floaters, deposit };
  }
  it('merges nearby deposits of the same resource without restarting their lifetime', () => {
    const { root, floaters, deposit } = fixture();
    deposit(); floaters.update(0.4); deposit(7, 22);
    expect(floaters.count).toBe(1);
    expect(root.children[0].textContent).toBe('+17 wood');
    deposit(10, 20, 'food'); deposit(10, 25);
    expect(floaters.count).toBe(3);
    floaters.update(0.2); deposit();
    expect(floaters.count).toBe(4); // first wood floater is now too old to merge
    floaters.update(1.01);
    expect(root.children.some(el => el.textContent === '+17 wood')).toBe(false);
    floaters.dispose(); expect(root.children).toHaveLength(0);
    deposit(); expect(floaters.count).toBe(0);
  });
  it('caps deposits at eight and never evicts combat loot for a deposit', () => {
    const { world, root, floaters, deposit } = fixture();
    for (let i = 0; i < 8; i++) world.events.emit({ type: 'looted', owner: 1, pos: { x: 20, z: 20 }, loot: { gold: i + 1 } });
    const loot = root.children.map(el => el.textContent);
    deposit(); expect(floaters.count).toBe(8);
    expect(root.children.map(el => el.textContent)).toEqual(loot);
    floaters.update(2);
    for (let i = 0; i < 10; i++) deposit(10, 10 + i * 3);
    expect(floaters.count).toBe(8);
  });
  it('filters unseen or foreign deposits and limits the low tier to five live texts', () => {
    const { world, floaters, deposit } = fixture('low');
    deposit(10, 20, 'wood', 2); expect(floaters.count).toBe(0);
    world.visibility.state.fill(0); deposit(); expect(floaters.count).toBe(0);
    world.visibility.state.fill(2);
    for (let i = 0; i < 10; i++) deposit(10, 10 + i * 3);
    expect(floaters.count).toBe(5);
  });
  it('keeps reduced-motion text stationary', () => {
    vi.spyOn(settings, 'currentSettings').mockReturnValue({ ...settings.currentSettings(), reducedMotion: true });
    const { root, floaters, deposit } = fixture();
    deposit(); floaters.update(0.1); const transform = root.children[0].style.transform;
    floaters.update(0.5); expect(root.children[0].style.transform).toBe(transform);
  });
});
