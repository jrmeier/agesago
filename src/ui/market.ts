import type { Building, MarketResource, PlayerId, ResourceType } from '../core/types';
import type { Selection } from '../game/Selection';
import {
  LOT,
  MARKET_RESOURCES,
  buyCost,
  marketTradeBlock,
  sellGain,
  tributeFeeOf,
} from '../sim/systems/market';
import type { World } from '../sim/World';

/**
 * Market panel (M8-12). Mounted by Hud into #selection-panel as #market-panel; shown while a
 * single finished market of the local player is selected. Buy / Sell 100 for food, wood and
 * stone at current prices, and a Tribute row (player, resource, 100 / 500). Training trade carts
 * comes from the generic training grid. On phones it sits in the Train sheet.
 */

const NAMES: Record<ResourceType, string> = { food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone' };
const TRIBUTE_RESOURCES: readonly ResourceType[] = ['food', 'wood', 'gold', 'stone'];
export const TRIBUTE_AMOUNTS: readonly number[] = [100, 500];

export interface MarketRow {
  resource: MarketResource;
  name: string;
  /** Gold to buy 100. */
  buy: number;
  /** Gold for selling 100. */
  sell: number;
  /** Why Buy is disabled (short, for the button), or null. */
  buyWhy: string | null;
  sellWhy: string | null;
}

/** Prices and button states for `owner`'s market panel. */
export function marketRows(world: World, owner: PlayerId): MarketRow[] {
  const p = world.players.get(owner);
  if (!p) return [];
  return MARKET_RESOURCES.map((resource) => {
    const buy = buyCost(p.prices[resource]);
    const sell = sellGain(p.prices[resource]);
    const why = (side: 'buy' | 'sell'): string | null => {
      const block = marketTradeBlock(world, owner, resource, side);
      if (!block) return null;
      if (block === 'requires') return 'Needs a market';
      if (block === 'insufficient-resources') return side === 'buy' ? `Need ${buy} gold` : `Need ${LOT} ${resource}`;
      return 'Unavailable';
    };
    return { resource, name: NAMES[resource], buy, sell, buyWhy: why('buy'), sellWhy: why('sell') };
  });
}

/** Players `owner` can send tribute to: everyone else still in the game. */
export function tributeTargets(world: World, owner: PlayerId): { id: PlayerId; name: string; ally: boolean }[] {
  const out: { id: PlayerId; name: string; ally: boolean }[] = [];
  for (const [id, p] of world.players) {
    if (id === owner || world.isDefeated(id)) continue;
    out.push({ id, name: p.player.name, ally: !world.areEnemies(owner, id) });
  }
  return out;
}

/** What a tribute of `amount` would actually send and deliver right now. */
export function tributePreview(
  world: World,
  owner: PlayerId,
  resource: ResourceType,
  amount: number
): { sent: number; received: number; fee: number } {
  const have = world.players.get(owner)?.stock[resource] ?? 0;
  const fee = tributeFeeOf(world, owner);
  const sent = Math.max(0, Math.floor(Math.min(amount, have)));
  return { sent, received: Math.floor(sent * (1 - fee)), fee };
}

/** The selected finished market of `owner`, if the selection is exactly that. */
export function selectedMarket(world: World, ids: ReadonlySet<number>, owner: PlayerId): Building | null {
  if (ids.size !== 1) return null;
  const b = world.buildings.get([...ids][0]);
  return b && b.kind === 'market' && b.complete && b.owner === owner ? b : null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(href: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  svg.append(use);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

function setText(e: Element | null | undefined, text: string): void {
  if (e && e.textContent !== text) e.textContent = text;
}

interface RowEls {
  prices: HTMLElement;
  buy: HTMLButtonElement;
  sell: HTMLButtonElement;
}

export class MarketPanel {
  readonly root: HTMLElement;
  private readonly rows = new Map<MarketResource, RowEls>();
  private readonly tributeBox: HTMLElement;
  private readonly to: HTMLSelectElement;
  private readonly res: HTMLSelectElement;
  private readonly sendButtons: HTMLButtonElement[] = [];
  private readonly note: HTMLElement;
  private key = '';
  private playersKey = '';

  constructor(
    private readonly world: World,
    private readonly selection: Selection,
    host: HTMLElement | null = document.getElementById('selection-panel')
  ) {
    const root = el('div', 'market-panel');
    root.id = 'market-panel';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Market');
    root.hidden = true;
    this.root = root;

    const table = el('div', 'market-rows');
    for (const r of MARKET_RESOURCES) {
      const label = el('div', 'market-res');
      label.append(icon(`#i-${r}`, 'market-icon'));
      const text = el('span', 'market-res-text');
      text.append(el('b', 'market-res-name', NAMES[r]));
      const prices = el('span', 'market-prices');
      text.append(prices);
      label.append(text);
      const buy = this.button('market-btn', 'Buy 100');
      buy.dataset.market = 'buy';
      buy.dataset.res = r;
      const sell = this.button('market-btn', 'Sell 100');
      sell.dataset.market = 'sell';
      sell.dataset.res = r;
      const row = el('div', 'market-row');
      row.dataset.res = r;
      row.append(label, buy, sell);
      table.append(row);
      this.rows.set(r, { prices, buy, sell });
    }

    const tribute = el('div', 'market-tribute');
    tribute.append(el('span', 'market-head', 'Tribute'));
    this.to = el('select', 'market-select');
    this.to.setAttribute('aria-label', 'Send tribute to');
    this.res = el('select', 'market-select');
    this.res.setAttribute('aria-label', 'Tribute resource');
    for (const r of TRIBUTE_RESOURCES) this.res.append(new Option(NAMES[r], r));
    tribute.append(this.to, this.res);
    for (const amount of TRIBUTE_AMOUNTS) {
      const b = this.button('market-btn market-send', `Send ${amount}`);
      b.dataset.tribute = String(amount);
      this.sendButtons.push(b);
      tribute.append(b);
    }
    this.note = el('span', 'market-note');
    tribute.append(this.note);
    this.tributeBox = tribute;

    root.append(table, tribute);
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', () => (this.key = ''));
    const before = host?.querySelector('#command-card') ?? null;
    if (host) host.insertBefore(root, before);
  }

  private button(className: string, label: string): HTMLButtonElement {
    const b = el('button', className);
    b.type = 'button';
    b.append(el('span', 'market-btn-label', label), el('small', 'market-btn-sub'));
    return b;
  }

  private onClick(e: Event): void {
    const btn = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!btn || btn.disabled) return;
    btn.blur();
    const side = btn.dataset.market;
    if (side === 'buy' || side === 'sell') {
      this.world.dispatch({ type: 'marketTrade', resource: btn.dataset.res as MarketResource, side });
    } else if (btn.dataset.tribute) {
      const to = Number(this.to.value);
      if (!to) return;
      this.world.dispatch({ type: 'tribute', to, resource: this.res.value as ResourceType, amount: Number(btn.dataset.tribute) });
    }
    this.key = '';
    this.update();
  }

  /** Per-frame refresh; only touches the DOM when something visible changed. */
  update(): void {
    const owner = this.world.localPlayer;
    const market = selectedMarket(this.world, this.selection.ids, owner);
    if (this.root.hidden !== !market) this.root.hidden = !market;
    if (!market) return;
    const rows = marketRows(this.world, owner);
    const targets = tributeTargets(this.world, owner);
    const resource = (this.res.value || 'food') as ResourceType;
    const previews = TRIBUTE_AMOUNTS.map((a) => tributePreview(this.world, owner, resource, a));
    const key = JSON.stringify([rows, targets, this.to.value, resource, previews]);
    if (key === this.key) return;
    this.key = key;

    for (const r of rows) {
      const els = this.rows.get(r.resource)!;
      setText(els.prices, `buy ${r.buy} · sell ${r.sell}`);
      this.setButton(els.buy, r.buyWhy, `−${r.buy} gold`, `Buy 100 ${r.resource} for ${r.buy} gold`);
      this.setButton(els.sell, r.sellWhy, `+${r.sell} gold`, `Sell 100 ${r.resource} for ${r.sell} gold`);
    }

    const pKey = targets.map((t) => `${t.id}:${t.name}:${t.ally}`).join('|');
    if (pKey !== this.playersKey) {
      this.playersKey = pKey;
      const keep = this.to.value;
      this.to.replaceChildren(...targets.map((t) => new Option(`${t.name}${t.ally ? ' (ally)' : ''}`, String(t.id))));
      if (targets.some((t) => String(t.id) === keep)) this.to.value = keep;
    }
    this.tributeBox.hidden = !targets.length;
    const fee = previews[0].fee;
    this.sendButtons.forEach((b, i) => {
      const p = previews[i];
      const why = p.sent <= 0 ? `No ${resource}` : null;
      this.setButton(b, why, `they get ${p.received}`, `Send ${p.sent} ${resource}; ${p.received} arrives after the fee`);
    });
    setText(this.note, `${Math.round(fee * 100)}% is lost on the way.`);
  }

  private setButton(b: HTMLButtonElement, why: string | null, sub: string, title: string): void {
    const disabled = why !== null;
    if (b.disabled !== disabled) b.disabled = disabled;
    b.classList.toggle('unaffordable', disabled);
    setText(b.querySelector('.market-btn-sub'), why ?? sub);
    const t = why ? `${title} — ${why}` : title;
    if (b.title !== t) {
      b.title = t;
      b.setAttribute('aria-label', t);
    }
  }
}
