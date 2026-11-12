import type { UnitKind, Vec2 } from '../core/types';
import { isHero, UNITS } from '../core/units';
import { heroDeathText } from './heroes';
import type { World } from '../sim/World';
import { AlertLimiter, BurstCounter, attackText, captureText, deathText, resignText, unlockText } from './alertRules';
import { pushPing } from './pings';
import { TECHS } from '../core/techs';
import { researchedText } from './research';
import { ageUnlocks } from './upgradeHints';

/** Seconds an alert toast stays up. */
const ALERT_LIFE = 6;
/** Most toasts in the shared stack. */
const MAX_SHOWN = 3;

/**
 * Combat alerts for the local player: "You are under attack! (north-east)" on 'attacked'
 * (rate-limited by AlertLimiter, with a minimap ping; clicking jumps the camera there), and a
 * small "A villager was killed" toast on 'died' (bursts batched). Toasts share the discovery
 * toast stack (`container`). A local 'researched' shows "Iron Axe researched", and a local
 * 'agedUp' lists what the new age unlocks ("Town Age unlocks: build Forge, Market · train Slinger").
 * A 'captured' building toasts for the side that lost it and the side that took it (M18-4).
 * A rival's resignation toasts too (M16-10).
 * `update(time)` must be called every frame.
 */
export class Alerts {
  private readonly limiter = new AlertLimiter();
  private readonly deaths = new BurstCounter();
  private lastDeath: Vec2 | null = null;
  private time = 0;
  /** Where the last "under attack" happened (for a jump-to-alert key later). */
  lastAttack: Vec2 | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly world: World,
    private readonly focusOn: (p: Vec2) => void
  ) {
    world.events.on('attacked', (e) => {
      if (e.owner !== world.localPlayer) return;
      if (!this.limiter.shouldAlert(e.pos, this.time)) return;
      this.lastAttack = { ...e.pos };
      pushPing(world, e.pos, 'attack');
      this.show('alert', '#i-alert', attackText(this.home(), e.pos), e.pos);
    });
    world.events.on('died', (e) => {
      if (e.owner === world.localPlayer && e.kind in UNITS && isHero(e.kind as UnitKind)) {
        pushPing(world, e.pos, 'death');
        this.show('alert', `#i-${e.kind}`, heroDeathText(e.kind as UnitKind), e.pos);
        return;
      }
      if (e.owner !== world.localPlayer || e.kind !== 'villager') return;
      this.lastDeath = { ...e.pos };
      pushPing(world, e.pos, 'death');
      const n = this.deaths.add(this.time);
      if (n) this.show('death', '#i-skull', deathText(n), e.pos);
    });
    // "Iron Axe researched" (age-ups get the banner instead; see Hud).
    // A new age: what it opens up (the banner says "Entered the Town Age"; see Hud).
    world.events.on('agedUp', (e) => {
      if (e.owner !== world.localPlayer) return;
      const civ = world.players.get(e.owner)?.player.civ;
      this.show('age', '#i-age', unlockText(e.age, ageUnlocks(e.age, civ)), this.home());
    });
    // Building capture (M18-4): both sides hear about it.
    world.events.on('captured', (e) => {
      const lost = e.previousOwner === world.localPlayer;
      if (!lost && e.owner !== world.localPlayer) return;
      const other = lost ? e.owner : e.previousOwner;
      const name = other === 0 ? null : (world.players.get(other)?.player.name ?? `Player ${other}`);
      pushPing(world, e.pos, 'attack');
      if (lost) this.show('alert', '#i-alert', captureText(e.kind, true, name), e.pos);
      else this.show('research', '#i-attack-move', captureText(e.kind, false, name), e.pos);
    });
    // A rival resigned (a beaten computer player does, M16-10).
    world.events.on('defeated', (e) => {
      if (e.reason !== 'resign' || e.player === world.localPlayer) return;
      this.show('research', '#i-alert', resignText(world.players.get(e.player)?.player.name ?? `Player ${e.player}`), this.home());
    });
    world.events.on('researched', (e) => {
      if (e.owner !== world.localPlayer || TECHS[e.tech].ageUp !== undefined) return;
      this.show('research', '#i-tech', researchedText(e.tech), this.home());
    });
  }

  update(time: number): void {
    this.time = time;
    const n = this.deaths.poll(time);
    if (n && this.lastDeath) this.show('death', '#i-skull', deathText(n), this.lastDeath);
  }

  private home(): Vec2 {
    return this.world.townCenterOf(this.world.localPlayer)?.pos ?? { x: this.world.hf.width / 2, z: this.world.hf.depth / 2 };
  }

  private show(kind: 'alert' | 'death' | 'research' | 'age', iconHref: string, text: string, pos: Vec2): void {
    const toast = document.createElement('button');
    toast.type = 'button';
    toast.className = `toast toast-${kind}`;
    toast.title = 'Show me';
    toast.setAttribute('role', kind === 'alert' ? 'alert' : 'status');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'toast-icon');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', iconHref);
    icon.append(use);
    const label = document.createElement('span');
    label.textContent = text;
    toast.append(icon, label);
    const at = { ...pos };
    const dismiss = () => {
      if (!toast.isConnected) return;
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 300);
    };
    toast.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.focusOn(at);
      dismiss();
    });
    this.container.append(toast);
    while (this.container.childElementCount > MAX_SHOWN) this.container.firstElementChild?.remove();
    setTimeout(dismiss, ALERT_LIFE * 1000);
  }
}
