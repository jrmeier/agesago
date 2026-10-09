import type { PropPlacement, Vec2 } from '../core/types';
import type { World } from '../sim/World';
import { DiscoveryTracker, RateLimitedQueue, discoveryText, findSites, type Site, type SiteKind } from './discover';

/** Seconds between discovery checks (only when the fog actually changed). */
const CHECK_INTERVAL = 0.5;
/** Minimum seconds between toasts. */
const TOAST_INTERVAL = 4;
/** Seconds a toast stays up. */
const TOAST_LIFE = 7;
/** Most toasts on screen at once (oldest leaves first). */
const MAX_SHOWN = 3;

const ICON: Record<SiteKind, string> = {
  ruins: '#i-ruins',
  stones: '#i-stones',
  hamlet: '#i-b-house',
  gold: '#i-gold',
  stone: '#i-stone',
};

/**
 * "Ruins discovered to the north-east" toasts: the first time the fog lifts off a point of
 * interest (ruins, standing stones, a hamlet, distant gold / stone), a parchment toast slides
 * in under the top bar; clicking / tapping it centres the camera there. At most one new toast
 * per 4 s; each site once. Sites already explored at startup never toast.
 */
export class Discoveries {
  readonly root: HTMLDivElement;
  private readonly tracker: DiscoveryTracker;
  private readonly queue = new RateLimitedQueue<Site>(TOAST_INTERVAL);
  private readonly home: Vec2;
  private version = -1;
  private lastCheck = -Infinity;

  constructor(
    container: HTMLElement,
    private readonly world: World,
    private readonly focusOn: (p: Vec2) => void,
    props: readonly PropPlacement[]
  ) {
    this.home = { ...world.townCenter.pos };
    this.tracker = new DiscoveryTracker(findSites(props, world.nodes.values(), this.home));
    const vis = world.visibility;
    this.tracker.check((x, z) => vis.isExplored(x, z));
    this.version = vis.version;
    this.root = document.createElement('div');
    this.root.className = 'toasts';
    this.root.dataset.hudInteractive = '';
    this.root.setAttribute('aria-live', 'polite');
    container.append(this.root);
  }

  /** Call every frame with elapsed seconds. */
  update(time: number): void {
    const vis = this.world.visibility;
    if (vis.version !== this.version && time - this.lastCheck >= CHECK_INTERVAL && this.tracker.remaining) {
      this.version = vis.version;
      this.lastCheck = time;
      for (const s of this.tracker.check((x, z) => vis.isExplored(x, z))) this.queue.push(s);
    }
    const next = this.queue.poll(time);
    if (next) this.show(next);
  }

  dispose(): void {
    this.root.remove();
  }

  private show(site: Site): void {
    const toast = document.createElement('button');
    toast.type = 'button';
    toast.className = 'toast';
    toast.title = 'Show on the map';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'toast-icon');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', ICON[site.kind]);
    icon.append(use);
    const text = document.createElement('span');
    text.textContent = discoveryText(site.kind, this.home, site.pos);
    toast.append(icon, text);
    const dismiss = () => {
      if (!toast.isConnected) return;
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.focusOn(site.pos);
      dismiss();
    });
    this.root.append(toast);
    while (this.root.childElementCount > MAX_SHOWN) this.root.firstElementChild?.remove();
    setTimeout(dismiss, TOAST_LIFE * 1000);
  }
}
