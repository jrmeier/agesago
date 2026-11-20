import { detectQuality, type QualityTier } from '../core/quality';
import { currentSettings } from '../game/settings';
import type { ResourceType, Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { formatLoot } from './endgameLog';

/** Seconds a floater stays up. */
const LIFE = 1.6;
/** Pixels it rises over its life. */
const RISE = 28;
/** At most this many at once; deposits only reuse other deposits. */
const MAX = 8;

interface Floater {
  el: HTMLDivElement;
  pos: Vec2;
  age: number;
  resource?: ResourceType;
  amount: number;
}

/**
 * "+12 food" text from local deposits and combat loot
 * (M15-5). Only for the local player and only when the spot is in view; a small fixed pool of
 * absolutely positioned elements, moved with the camera via `project` (client px or null).
 */
export class LootFloaters {
  private readonly live: Floater[] = [];
  private readonly unlisten: (() => void)[];

  constructor(
    private readonly root: HTMLElement,
    world: World,
    private readonly project: (p: Vec2) => { x: number; y: number } | null,
    private readonly tier: QualityTier = floaterTier(),
  ) {
    this.unlisten = [world.events.on('looted', (e) => {
      if (e.owner !== world.localPlayer || !world.visibility.isVisible(e.pos.x, e.pos.z)) return;
      const text = formatLoot(e.loot);
      if (text) this.spawn(text, e.pos);
    }), world.events.on('deposited', (e) => {
      if (e.owner !== world.localPlayer || !world.visibility.isVisible(e.pos.x, e.pos.z)) return;
      if (this.tier === 'low' && this.live.length > 4) return;
      const merged = this.live.find((f) => f.resource === e.resource && f.age <= 0.5
        && Math.hypot(f.pos.x - e.pos.x, f.pos.z - e.pos.z) <= 2);
      if (merged) {
        merged.amount += e.amount;
        merged.el.textContent = formatLoot({ [e.resource]: merged.amount });
      } else this.spawn(formatLoot({ [e.resource]: e.amount }), e.pos, e.resource, e.amount);
    })];
  }

  private spawn(text: string, pos: Vec2, resource?: ResourceType, amount = 0): void {
    // A deposit may recycle another deposit, but never displace rarer combat loot.
    const index = resource ? this.live.findIndex((f) => f.resource !== undefined) : 0;
    if (this.live.length >= MAX && index < 0) return;
    let f = this.live.length >= MAX ? this.live.splice(index, 1)[0] : undefined;
    if (!f) {
      const el = document.createElement('div');
      el.className = 'loot-floater';
      el.setAttribute('aria-hidden', 'true');
      this.root.append(el);
      f = { el, pos, age: 0, amount };
    }
    f.el.textContent = text;
    f.pos = { x: pos.x, z: pos.z };
    f.age = 0;
    f.resource = resource;
    f.amount = amount;
    this.live.push(f);
  }

  /** Call every frame with elapsed real seconds; `show` false hides them (first-person view). */
  update(dt: number, show = true): void {
    if (!this.live.length) return;
    const rise = currentSettings().reducedMotion ? 0 : RISE;
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
      f.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - rise * t)}px) translate(-50%, -100%)`;
    }
  }

  get count(): number {
    return this.live.length;
  }

  dispose(): void {
    for (const off of this.unlisten) off();
    for (const f of this.live) f.el.remove();
    this.live.length = 0;
  }
}

function floaterTier(): QualityTier {
  const choice = currentSettings().quality;
  return choice === 'auto' ? detectQuality().tier : choice;
}
