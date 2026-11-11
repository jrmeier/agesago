import type { Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { formatLoot } from './endgameLog';

/** Seconds a floater stays up. */
const LIFE = 1.6;
/** Pixels it rises over its life. */
const RISE = 28;
/** At most this many at once; the oldest is reused. */
const MAX = 8;

interface Floater {
  el: HTMLDivElement;
  pos: Vec2;
  age: number;
}

/**
 * "+12 food" text that rises from where the local player's kill or razed building gave loot
 * (M15-5). Only for the local player and only when the spot is in view; a small fixed pool of
 * absolutely positioned elements, moved with the camera via `project` (client px or null).
 */
export class LootFloaters {
  private readonly live: Floater[] = [];
  private readonly unlisten: () => void;

  constructor(
    private readonly root: HTMLElement,
    world: World,
    private readonly project: (p: Vec2) => { x: number; y: number } | null,
  ) {
    this.unlisten = world.events.on('looted', (e) => {
      if (e.owner !== world.localPlayer || !world.visibility.isVisible(e.pos.x, e.pos.z)) return;
      const text = formatLoot(e.loot);
      if (text) this.spawn(text, e.pos);
    });
  }

  private spawn(text: string, pos: Vec2): void {
    let f = this.live.length >= MAX ? this.live.shift() : undefined;
    if (!f) {
      const el = document.createElement('div');
      el.className = 'loot-floater';
      el.setAttribute('aria-hidden', 'true');
      this.root.append(el);
      f = { el, pos, age: 0 };
    }
    f.el.textContent = text;
    f.pos = { x: pos.x, z: pos.z };
    f.age = 0;
    this.live.push(f);
  }

  /** Call every frame with elapsed real seconds; `show` false hides them (first-person view). */
  update(dt: number, show = true): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.age += dt;
      const at = show && f.age < LIFE ? this.project(f.pos) : null;
      if (f.age >= LIFE) {
        f.el.remove();
        this.live.splice(i, 1);
        continue;
      }
      if (!at) {
        f.el.style.opacity = '0';
        continue;
      }
      const t = f.age / LIFE;
      f.el.style.opacity = String(1 - t * t);
      f.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - RISE * t)}px) translate(-50%, -100%)`;
    }
  }

  get count(): number {
    return this.live.length;
  }

  dispose(): void {
    this.unlisten();
    for (const f of this.live) f.el.remove();
    this.live.length = 0;
  }
}
