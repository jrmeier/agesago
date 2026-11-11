import type { World } from '../sim/World';
import { pushPing } from './pings';

/** "4:05" for a countdown in game seconds (rounded up, so 0:00 only shows at the end). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Wonder victory countdown in the top bar (M16-7). Every player sees it, in the owner's colour;
 * a wonder starting its countdown pings the minimap. `update()` runs every frame.
 */
export class WonderTimer {
  readonly el: HTMLElement;
  private readonly time: HTMLElement;
  private readonly swatch: HTMLElement;
  private readonly unlisten: (() => void)[] = [];
  private shown = '';

  constructor(private readonly world: World, bar: Element | null = document.querySelector('#hud .resource-bar')) {
    const el = document.createElement('div');
    el.id = 'wonder-timer';
    el.className = 'res res-wonder';
    el.setAttribute('role', 'timer');
    el.hidden = true;
    this.swatch = document.createElement('span');
    this.swatch.className = 'wonder-swatch';
    this.swatch.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'res-label';
    label.textContent = 'Wonder';
    this.time = document.createElement('span');
    this.time.id = 'wonder-time';
    el.append(this.swatch, label, this.time);
    bar?.append(el);
    this.el = el;
    this.unlisten.push(world.events.on('wonderStarted', (e) => pushPing(world, e.pos, 'wonder')));
    this.update();
  }

  update(): void {
    const c = this.world.wonder;
    const on = c !== null && this.world.wonderRules.enabled;
    if (this.el.hidden === on) this.el.hidden = !on;
    if (!c || !on) {
      this.shown = '';
      return;
    }
    const text = formatCountdown(c.remaining);
    const key = `${c.owner}:${text}`;
    if (key === this.shown) return;
    this.shown = key;
    const player = this.world.players.get(c.owner)?.player;
    const color = `#${(player?.color ?? 0xc8a453).toString(16).padStart(6, '0')}`;
    const name = player?.name ?? `Player ${c.owner}`;
    this.time.textContent = text;
    this.el.style.setProperty('--wonder-owner', color);
    this.el.dataset.owner = String(c.owner);
    this.el.title = `${name}'s wonder wins in ${text} unless it is destroyed`;
    this.el.setAttribute('aria-label', this.el.title);
  }

  dispose(): void {
    for (const off of this.unlisten) off();
    this.el.remove();
  }
}
