import { BUILDINGS, FARM_FOOD } from '../core/buildings';
import { AGE_NAMES, TECHS, buildingTier, techsAt, unitLine, type Age, type TechId } from '../core/techs';
import type { Building, BuildingKind, ResourceType, Stockpile, Unit, UnitKind } from '../core/types';
import { UNITS, trainable } from '../core/units';
import type { Selection } from '../game/Selection';
import { shownSelection, sightFromState, stepLastSeen, type LastSeenBuilding } from '../render/lastSeen';
import { BALANCE } from '../sim/balance';
import { productionOrder } from '../sim/productionQueue';
import { carryCap } from '../sim/systems/gather';
import { trainTime } from '../sim/systems/train';
import { ageBuildings, ageBuildingsNeeded, researchBlock, statOf } from '../sim/systems/research';
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
import {
  STANCES,
  canTrainAt,
  hpLabel,
  isMilitary,
  sharedStance,
  totalHp,
  trainBatch,
  trainEntries,
} from './military';
import { MarketPanel } from './market';
import {
  agedUpText,
  ageLockText,
  queueItems,
  researchLabel,
  techEntries,
  techTip,
  techsNewAt,
  timeLabel,
  unitAge,
  upgradedBuildingChips,
  upgradedUnitChips,
  type TechEntry,
  type TechView,
} from './research';
import { closeTouchMenus, toggleTouchMenu, touchMenuOpen, type TouchMenu } from './touchMenus';

/** Length of the train ring's circle (its `pathLength`). */
const RING = 100;
/** How long the "Need more houses" note stays up (ms). */
const POP_NOTE_MS = 2600;
/** How long the "Entered the Town Age" banner stays up (ms). */
const AGE_BANNER_MS = 3200;
/** Touch: hold a tile this long to see its tooltip (ms). */
const LONG_PRESS_MS = 450;
/** Short age labels for the phone's top bar. */
const AGE_SHORT = ['I', 'II', 'III', 'IV'] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Binds the existing DOM in index.html: #res-food/#res-wood/#res-gold/#res-stone/#res-pop
 * (pop shows "pop/popCap"; #pop-plaque flashes and #pop-note says "Need more houses" when
 * training hits the cap), #selection-panel (+ .hidden, .building-mode, .enemy for a read-only
 * enemy panel), #unit-name, #unit-status, #unit-hp (health bar), #unit-stats (attack /
 * armour / range chips for soldiers), .unit-portrait (its <use> swaps between unit and building
 * icons), #explore-btn (shown when the selection can explore; Controls handles the click),
 * #build-grid (one [data-build] button per buildable kind, shown when villagers are selected;
 * Controls handles clicks), #build-progress / #cancel-build-btn (building panel for a selected
 * foundation; Controls handles the click), #train-grid (one [data-train] button per unit a
 * selected complete building trains — click trains one, Shift-click five; dispatched here),
 * #train-queue (queue strip; click an entry to cancel it), #command-card (attack-move / stop / stances; this
 * class shows it and marks the current stance, Controls handles clicks). On a phone the build grid, training
 * grid and command card stay behind #menu-tabs (Build / Train / Orders) until that tab is open, and
 * #select-same-btn shows when the selection is one kind of own unit. #train-btn
 * (.train-sub label, .train-ring-fill progress ring, .training while queued). Updates from
 * world.events and selection changes.
 * M8: the training grid also lists the selected building's techs under a "Research" header
 * (click queues `research`; locked tiles say why; long-press on touch shows the tooltip), the
 * queue strip mixes research with units in command order, #age-plaque shows the age with a slim bar
 * while an age-up runs, #age-banner announces a new age, and age-locked build / train tiles
 * are greyed with "Requires Town Age".
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
    bell: byId('town-bell-btn'),
    ungarrison: byId('ungarrison-btn'),
    hp: byId('unit-hp'),
    stats: byId('unit-stats'),
    trainGrid: byId('train-grid'),
    queue: byId('train-queue'),
    commands: byId('command-card'),
    menus: byId('menu-tabs'),
    same: byId('select-same-btn'),
    agePlaque: byId('age-plaque'),
    age: byId('res-age'),
    banner: byId('age-banner'),
    tip: byId('tech-tip'),
  };
  private readonly ageFill: HTMLElement | null;
  private readonly techButtons = new Map<TechId, HTMLButtonElement>();
  private researchHead: HTMLElement | null = null;
  private researchKey = '';
  /** Techs that opened up at the last age-up and haven't been looked at yet. */
  private readonly fresh = new Set<TechId>();
  private ageKey = '';
  private bannerTimer = 0;
  private pressTimer = 0;
  private tipTimer = 0;
  /** Set by a long-press so the click that follows doesn't also queue. */
  private swallowClick = false;
  private readonly trainSub: HTMLElement | null;
  private readonly trainRing: SVGElement | null;
  private readonly portrait: HTMLElement | null;
  private readonly portraitUse: SVGUseElement | null;
  private readonly progressFill: HTMLElement | null;
  private readonly hpFill: HTMLElement | null;
  private readonly hpText: HTMLElement | null;
  private readonly buildButtons = new Map<BuildingKind, HTMLButtonElement>();
  private readonly trainButtons = new Map<UnitKind, HTMLButtonElement>();
  private readonly stanceButtons = new Map<string, HTMLElement>();
  private portraitShown = '#i-villager';
  private dimmed: boolean | null = null;
  private ringOffset = '';
  private affordKey = '';
  private popNoteTimer = 0;
  /** Building kind the training grid was built for ('' = none). */
  private trainKind: BuildingKind | '' = '';
  /** Unit-line tiers the training grid was built for. */
  private trainLineKey = '';
  /** Building the training grid dispatches to. */
  private trainBuildingId: number | null = null;
  private trainAffordKey = '';
  private queueKey = '';
  private queueHead = '';
  private statsKey = '';
  private hpKey = '';
  private readonly menuTabs: Record<TouchMenu, HTMLElement | null>;
  /** Enemy buildings the panel may describe while they are out of sight. */
  private snaps = new Map<number, LastSeenBuilding>();
  /** Buy / sell / tribute panel for a selected own market (M8-12, src/ui/market.ts). */
  private readonly market: MarketPanel;

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
    this.hpFill = this.el.hp?.querySelector<HTMLElement>('.unit-hp-fill') ?? null;
    this.hpText = this.el.hp?.querySelector<HTMLElement>('.unit-hp-text') ?? null;
    this.ageFill = this.el.agePlaque?.querySelector<HTMLElement>('.age-bar-fill') ?? null;
    for (const btn of this.el.commands?.querySelectorAll<HTMLElement>('[data-stance]') ?? []) {
      this.stanceButtons.set(btn.dataset.stance!, btn);
    }
    this.menuTabs = {
      build: this.el.menus?.querySelector<HTMLElement>('[data-menu="build"]') ?? null,
      train: this.el.menus?.querySelector<HTMLElement>('[data-menu="train"]') ?? null,
      orders: this.el.menus?.querySelector<HTMLElement>('[data-menu="orders"]') ?? null,
    };
    this.el.menus?.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('[data-menu]');
      const menu = btn?.dataset.menu;
      if (menu !== 'build' && menu !== 'train' && menu !== 'orders') return;
      btn?.blur();
      toggleTouchMenu(menu);
    });
    this.buildGrid();
    this.market = new MarketPanel(world, selection, this.el.panel);
    this.setStock(world.stock, world.pop, world.popCap);
    world.events.on('stockpile', (e) => this.setStock(e.stock, e.pop, e.popCap));
    world.events.on('rejected', (e) => {
      if (e.reason === 'insufficient-food' || e.reason === 'pop-cap') this.flashTrain();
      if (e.reason === 'insufficient-resources' || e.reason === 'pop-cap') this.flashTrainGrid();
      if (e.reason === 'pop-cap') this.flashPop();
      if (e.reason === 'age' || e.reason === 'requires' || e.reason === 'busy') this.flashTrainGrid();
    });
    world.events.on('agedUp', (e) => {
      if (e.owner !== world.localPlayer) return;
      for (const t of techsNewAt(e.age)) this.fresh.add(t);
      this.researchKey = '';
      this.showBanner(agedUpText(e.age));
    });
    selection.onChange(() => this.updateSelection());
    this.el.train?.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.onTrain();
    });
    this.el.trainGrid?.addEventListener('click', (e) => {
      const tech = (e.target as Element).closest<HTMLElement>('[data-research]');
      if (tech) {
        tech.blur();
        this.researchAt(tech.dataset.research as TechId, tech.dataset.locked === 'true');
        return;
      }
      const btn = (e.target as Element).closest<HTMLElement>('[data-train]');
      if (!btn) return;
      btn.blur();
      if (btn.dataset.locked === 'true') {
        this.flashTrainGrid();
        return;
      }
      this.trainAt(btn.dataset.train as UnitKind, (e as MouseEvent).shiftKey);
    });
    this.bindLongPress(this.el.trainGrid);
    this.bindLongPress(this.el.grid);
    this.update();
  }

  /** Per-frame refresh for things not driven by events (e.g. selected unit status). */
  update(): void {
    this.updateSelection();
    this.updateTrain();
    this.market.update();
    this.updateAge();
  }

  private playerAge(): Age {
    return this.world.players.get(this.world.localPlayer)?.age ?? 0;
  }

  /** Queue `tech` at the building whose panel is open; a locked tile just shakes and shows why. */
  private researchAt(tech: TechId, locked: boolean): void {
    const id = this.trainBuildingId;
    if (id === null) return;
    if (locked) {
      this.flashTrainGrid();
      const btn = this.techButtons.get(tech);
      if (btn && document.body.classList.contains('touch')) this.showTip(btn);
      return;
    }
    this.world.dispatch({ type: 'research', buildingId: id, tech });
  }

  /** Touch: holding a tile shows its tooltip (title) in #tech-tip instead of clicking it. */
  private bindLongPress(grid: HTMLElement | null): void {
    if (!grid) return;
    const clear = () => clearTimeout(this.pressTimer);
    // A long-press shows the tip instead of activating the tile: eat the click that follows it,
    // in the capture phase so Controls' own build-grid handler never sees it either.
    grid.addEventListener(
      'click',
      (e) => {
        if (!this.swallowClick) return;
        this.swallowClick = false;
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      { capture: true }
    );
    grid.addEventListener('pointerdown', (e) => {
      clear();
      // Each press starts fresh, so a long-press with no follow-up click can't eat a later tap.
      this.swallowClick = false;
      if (e.pointerType === 'mouse') return;
      const btn = (e.target as Element).closest<HTMLElement>('[data-tip]');
      if (!btn) return;
      this.pressTimer = window.setTimeout(() => {
        this.swallowClick = true;
        this.showTip(btn);
      }, LONG_PRESS_MS);
    });
    grid.addEventListener('pointerup', clear);
    grid.addEventListener('pointercancel', clear);
    grid.addEventListener('pointerleave', clear);
    grid.addEventListener('contextmenu', (e) => {
      if ((e.target as Element).closest('[data-tip]')) e.preventDefault();
    });
  }

  private showTip(btn: HTMLElement): void {
    const tip = this.el.tip;
    if (!tip) return;
    tip.textContent = btn.dataset.tip ?? btn.title;
    tip.hidden = false;
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => (tip.hidden = true), 4000);
  }

  /** Age plaque text, and its slim bar while an age-up researches at a Town Center. */
  private updateAge(): void {
    const age = this.playerAge();
    let progress = -1;
    for (const b of this.world.buildings.values()) {
      if (b.owner !== this.world.localPlayer || b.kind !== 'townCenter') continue;
      const head = b.research?.[0];
      if (head && TECHS[head].ageUp !== undefined) progress = Math.min(1, (b.researchProgress ?? 0) / TECHS[head].time);
    }
    const key = `${age}|${progress < 0 ? '' : (progress * 100).toFixed(0)}`;
    if (key === this.ageKey) return;
    this.ageKey = key;
    if (this.el.age) {
      setText(this.el.age, AGE_NAMES[age]);
      this.el.age.dataset.short = AGE_SHORT[age];
    }
    if (this.el.agePlaque) {
      this.el.agePlaque.classList.toggle('advancing', progress >= 0);
      this.el.agePlaque.title = progress >= 0
        ? `${AGE_NAMES[age]} · advancing ${Math.floor(progress * 100)}%`
        : `Current age: ${AGE_NAMES[age]}`;
    }
    if (this.ageFill) this.ageFill.style.width = `${Math.max(0, progress) * 100}%`;
  }

  /** "Entered the Town Age": fades in and out (CSS keeps it still under reduced motion). */
  private showBanner(text: string): void {
    const banner = this.el.banner;
    if (!banner) return;
    banner.textContent = text;
    banner.hidden = false;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      banner.classList.remove('show');
      banner.hidden = true;
    }, AGE_BANNER_MS);
  }

  /** Queue `kind` at the building whose training panel is open (five with Shift). */
  private trainAt(kind: UnitKind, shift: boolean): void {
    const id = this.trainBuildingId;
    if (id === null) return;
    for (let i = 0; i < trainBatch(shift); i++) this.world.dispatch({ type: 'train', buildingId: id, unit: kind });
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
      const btn = tile(`#i-b-${kind}`, spec.name, spec.cost, BUILD_HOTKEYS[kind]);
      btn.dataset.build = kind;
      grid.append(btn);
      this.buildButtons.set(kind, btn);
    }
  }

  /** Rebuild the training grid for a building kind ('' empties it). */
  private buildTrainGrid(kind: BuildingKind | ''): void {
    this.trainKind = kind;
    this.trainAffordKey = '';
    this.trainButtons.clear();
    const grid = this.el.trainGrid;
    if (!grid) return;
    grid.replaceChildren();
    this.techButtons.clear();
    this.researchKey = '';
    this.researchHead = null;
    if (!kind) return;
    for (const e of trainEntries(kind, this.world.stock, this.world.players.get(this.world.localPlayer)?.researched)) {
      const btn = tile(`#i-${e.kind}`, e.name, e.cost, e.key, 'Shift-click: queue 5');
      btn.classList.add('train-tile');
      btn.dataset.train = e.kind;
      grid.append(btn);
      this.trainButtons.set(e.kind, btn);
    }
    if (techsAt(kind).length) {
      const head = document.createElement('h4');
      head.className = 'research-head';
      head.textContent = 'Research';
      grid.append(head);
      this.researchHead = head;
    }
  }

  /** What researchBlock and the tiles need to know about the local player. */
  private techView(): TechView {
    const local = this.world.localPlayer;
    const p = this.world.players.get(local);
    const queued = new Set<TechId>();
    for (const b of this.world.buildings.values()) if (b.owner === local) for (const t of b.research ?? []) queued.add(t);
    const age = p?.age ?? 0;
    return {
      age,
      researched: p?.researched ?? new Set(),
      queued,
      stock: this.world.stock,
      ageBuildings: ageBuildings(this.world, local, age).length,
      ageBuildingsNeeded: ageBuildingsNeeded(age),
    };
  }

  /** Rebuild the tech tiles under the Research header when anything about them changed. */
  private updateResearch(b: Building): void {
    const grid = this.el.trainGrid;
    if (!grid || !this.researchHead) return;
    const view = this.techView();
    const entries = techEntries(b.kind, view, (t) => researchBlock(this.world, this.world.localPlayer, t));
    const key = entries.map((e) => `${e.tech}:${e.locked ? 'L' : ''}${e.unaffordable ? 'U' : ''}${e.reason}${this.fresh.has(e.tech) ? '*' : ''}`).join(',');
    setHidden(this.researchHead, !entries.length);
    this.menuTabs.train?.classList.toggle('has-new', entries.some((e) => this.fresh.has(e.tech)));
    if (key === this.researchKey) return;
    this.researchKey = key;
    for (const btn of this.techButtons.values()) btn.remove();
    this.techButtons.clear();
    for (const e of entries) {
      const btn = techTile(e, this.fresh.has(e.tech));
      grid.append(btn);
      this.techButtons.set(e.tech, btn);
    }
  }

  private updateSelection(): void {
    const local = this.world.localPlayer;
    const vis = this.world.visibility;
    const sightAt = (x: number, z: number) => sightFromState(vis.stateAt(x, z));
    // Fogged enemies come from `shown` only. Do not read the live building for hp or progress.
    this.snaps = stepLastSeen(this.snaps, this.world.buildings.values(), local, sightAt).snaps;
    const shown = shownSelection(
      this.selection.ids,
      local,
      (id) => this.world.units.get(id),
      (id) => this.world.buildings.get(id),
      this.snaps,
      sightAt,
    );
    const units: Unit[] = [];
    for (const id of shown.unitIds) {
      const u = this.world.units.get(id);
      if (u) units.push(u);
    }
    const building = shown.liveBuildingId != null ? this.world.buildings.get(shown.liveBuildingId) : undefined;
    const remembered = shown.remembered;
    const target = units.length ? 'units' : building || remembered ? 'building' : null;
    const owner = units.length ? units[0].owner : (building?.owner ?? remembered?.owner);
    const foreign = target !== null && owner !== local;
    const own = foreign ? [] : units;
    const ownBuilding = foreign ? undefined : building;
    this.el.panel?.classList.toggle('hidden', target === null);
    this.el.panel?.classList.toggle('building-mode', target === 'building');
    this.el.panel?.classList.toggle('enemy', foreign);
    this.updateExplore(own);
    const villagers = own.some((u) => u.kind === 'villager');
    setHidden(this.el.grid, !villagers);
    if (villagers) this.updateAffordable();
    this.updateCommands(own);
    this.updateBuilding(target === 'building' ? building : undefined, ownBuilding);
    if (target === 'units') {
      const kinds = units.map((u) => u.kind);
      const lineOf = (k: UnitKind) => unitLine(this.world.players.get(units[0].owner)?.researched ?? new Set(), k);
      const same = kinds.every((k) => k === kinds[0]);
      const line = same ? lineOf(kinds[0]) : null;
      setText(this.el.name, line && line.tier > 0 ? (units.length > 1 ? `${units.length} × ${line.title}` : line.title) : selectionName(kinds));
      const capacity = carryCap(this.world, units[0], units[0].carry?.type ?? units[0].gatherType ?? 'wood');
      setText(this.el.status, foreign ? this.ownerName(owner) : kinds.every(k => k === 'priest')
        ? (units.some(u => u.relic) ? 'Carrying a relic · Move beside your temple to enshrine' : 'Move to standing stones for relics · Order on ally to heal, enemy to convert')
        : groupStatus(units, capacity));
      this.setPortrait(`#i-${portraitKind(kinds)}`, units.length > 1 ? String(units.length) : '');
      const hp = totalHp(units);
      this.setHp(hp.hp, hp.maxHp);
      const single = kinds.every((k) => k === kinds[0]) ? kinds[0] : null;
      this.setStats(single && (isMilitary(single) || foreign) ? single : null, units[0].owner);
    } else if (building) {
      this.setHp(building.complete ? building.hp : -1, building.maxHp);
      this.setBuildingStats(building.complete ? building : null);
    } else if (remembered) {
      setText(this.el.name, BUILDINGS[remembered.kind].name);
      setText(this.el.status, this.ownerName(remembered.owner));
      this.setPortrait(`#i-b-${remembered.kind}`, '');
      this.setHp(remembered.complete ? remembered.hp : -1, remembered.maxHp);
      this.setStats(null);
    } else {
      this.setHp(-1, 0);
      this.setStats(null);
    }
    const showBuild = villagers;
    const showTrain = !!this.el.trainGrid && !this.el.trainGrid.hidden;
    const showOrders = !!this.el.commands && !this.el.commands.hidden;
    this.syncTouchMenus(showBuild, showTrain, showOrders, own.length > 0 && own.every((u) => u.kind === own[0].kind));
  }

  /** Show only the tabs whose sheet has something in it, and the These button for a single kind. */
  private syncTouchMenus(showBuild: boolean, showTrain: boolean, showOrders: boolean, sameKind: boolean): void {
    setHidden(this.menuTabs.build, !showBuild);
    setHidden(this.menuTabs.train, !showTrain);
    setHidden(this.menuTabs.orders, !showOrders);
    setHidden(this.el.menus, !(showBuild || showTrain || showOrders));
    const open = touchMenuOpen();
    if ((open === 'build' && !showBuild) || (open === 'train' && !showTrain) || (open === 'orders' && !showOrders)) {
      closeTouchMenus();
    }
    setHidden(this.el.same, !sameKind);
  }

  private ownerName(owner: number | undefined): string {
    if (owner === undefined || owner === 0) return 'Wild';
    return this.world.players.get(owner)?.player.name ?? `Player ${owner}`;
  }

  /** Command card: attack-move / stop for any own units; stances only when soldiers or scouts are in it. */
  private updateCommands(own: readonly Unit[]): void {
    const card = this.el.commands;
    if (!card) return;
    setHidden(card, !own.length);
    if (!own.length) return;
    const fighters = own.filter((u) => u.kind !== 'villager');
    card.classList.toggle('no-stances', !fighters.length);
    const stance = sharedStance(fighters);
    for (const { stance: s } of STANCES) {
      const btn = this.stanceButtons.get(s);
      const pressed = String(stance === s);
      if (btn && btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
    }
  }

  /** Building panel: foundation progress, training grid + queue for own trainers, role text. */
  private updateBuilding(b: Building | undefined, own: Building | undefined): void {
    const foundation = !!own && !own.complete;
    const shelter = !!own && own.complete && (BUILDINGS[own.kind].garrison ?? 0) > 0;
    setHidden(this.el.progress, !foundation);
    setHidden(this.el.cancel, !foundation);
    setHidden(this.el.bell, !shelter);
    setHidden(this.el.ungarrison, !shelter || !(own?.occupants?.length));
    const trainer = own && canTrainAt(own) ? own : undefined;
    const researcher = own && own.complete && techsAt(own.kind).length ? own : undefined;
    const panel = trainer ?? researcher;
    const kind = panel?.kind ?? '';
    // Unit-line upgrades rename tiles (Hoplite → Veteran Hoplite), so they also rebuild the grid.
    const lineSet = this.world.players.get(this.world.localPlayer)?.researched;
    const lineKey = kind && lineSet ? trainable(kind).map((k) => unitLine(lineSet, k).tier).join() : '';
    if (kind !== this.trainKind || lineKey !== this.trainLineKey) {
      // Leaving a building's panel: its new techs have been seen.
      if (kind !== this.trainKind && this.trainKind) for (const t of techsAt(this.trainKind)) this.fresh.delete(t);
      this.trainLineKey = lineKey;
      this.buildTrainGrid(kind);
    }
    this.trainBuildingId = panel?.id ?? null;
    setHidden(this.el.trainGrid, !panel);
    setHidden(this.el.queue, !panel || (panel.queue <= 0 && !panel.research?.length));
    if (!panel) this.menuTabs.train?.classList.remove('has-new');
    if (panel) {
      setText(this.menuTabs.train, trainable(panel.kind).length ? 'Train' : 'Research');
      this.updateTrainAffordable();
      this.updateResearch(panel);
      this.updateQueue(panel);
    }
    if (!b) return;
    const researched = this.world.players.get(b.owner)?.researched ?? new Set<TechId>();
    setText(this.el.name, buildingTier(researched, b.kind).title ?? BUILDINGS[b.kind].name);
    this.setPortrait(`#i-b-${b.kind}`, '');
    if (!own) {
      setText(this.el.status, this.ownerName(b.owner));
    } else if (foundation) {
      setText(this.el.status, constructionLabel(b.buildProgress));
      const w = `${(Math.min(1, Math.max(0, b.buildProgress)) * 100).toFixed(1)}%`;
      if (this.progressFill && this.progressFill.style.width !== w) this.progressFill.style.width = w;
    } else if (panel && panel.research?.length && productionOrder(panel)[0] === 'research') {
      setText(this.el.status, researchLabel(panel.research[0], panel.researchProgress ?? 0, panel.research.length));
    } else if (trainer && b.queue > 0) {
      const head = b.queueKinds?.[0];
      const total = head ? trainTime(this.world, b, head) : BALANCE.trainTime;
      setText(this.el.status, trainLabel(b.queue, b.progress, total, 0, true));
    } else {
      setText(this.el.status, buildingRole(b.kind, b.food, FARM_FOOD, b.occupants?.length ?? 0));
    }
  }

  /** Queue strip: one icon per queued unit, the head with a progress fill. Click an icon to cancel it (refund). */
  private updateQueue(b: Building): void {
    const q = this.el.queue;
    if (!q) return;
    const kind = b.queueKinds?.[0];
    const view = queueItems(b, kind ? trainTime(this.world, b, kind) : undefined);
    const key = `${b.id}|${view.items.map((it) => (it.type === 'tech' ? `t:${it.tech}` : it.unit)).join(',')}`;
    if (key !== this.queueKey) {
      this.queueKey = key;
      this.queueHead = '';
      q.replaceChildren();
      view.items.forEach((it, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `queue-item${i === 0 ? ' head' : ''}${it.type === 'tech' ? ' tech' : ''}`;
        if (it.type === 'tech') {
          item.dataset.tech = it.tech;
          item.title = `${TECHS[it.tech].name}${i === 0 ? ' (researching)' : ''} — click to cancel (refund)`;
        } else {
          const doing = i === 0 ? ' (training)' : ' (queued)';
          const name = unitLine(this.world.players.get(b.owner)?.researched ?? new Set(), it.unit).title;
          item.title = `${name}${doing} — click to cancel`;
        }
        item.setAttribute('aria-label', item.title);
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (it.type === 'tech') this.world.dispatch({ type: 'cancelResearch', buildingId: b.id, index: it.index });
          else this.world.dispatch({ type: 'cancelTrain', buildingId: b.id, index: it.index });
        });
        item.append(icon(it.type === 'tech' ? techIcon(it.tech) : `#i-${it.unit}`, 'queue-icon'));
        if (i === 0) {
          const bar = document.createElement('span');
          bar.className = 'queue-fill';
          item.append(bar);
        }
        q.append(item);
      });
    }
    const w = `${(view.head * 100).toFixed(0)}%`;
    if (w !== this.queueHead) {
      this.queueHead = w;
      const fill = q.querySelector<HTMLElement>('.queue-fill');
      if (fill) fill.style.width = w;
    }
  }

  private setHp(hp: number, maxHp: number): void {
    const show = hp >= 0 && maxHp > 0;
    setHidden(this.el.hp, !show);
    if (!show) return;
    const key = `${Math.ceil(hp)}/${maxHp}`;
    if (key === this.hpKey) return;
    this.hpKey = key;
    const f = Math.min(1, Math.max(0, hp / maxHp));
    setText(this.hpText, hpLabel(hp, maxHp));
    if (this.hpFill) {
      this.hpFill.style.width = `${(f * 100).toFixed(1)}%`;
      this.hpFill.classList.toggle('low', f < 0.35);
    }
  }

  /** Attack / armour / range chips for a single unit kind with `owner`'s upgrades, "5 (+2)" (null hides them). */
  private setStats(kind: UnitKind | null, owner = this.world.localPlayer): void {
    const n = this.world.players.get(owner)?.researched.size ?? 0;
    this.showChips(kind ? `u:${kind}|${owner}|${n}` : '', () =>
      kind ? upgradedUnitChips(UNITS[kind], (stat, base) => statOf(this.world, owner, { unit: kind }, stat, base)) : []
    );
  }

  /** Towers and the Town Center: attack / armour / range with upgrades. Other buildings hide the chips. */
  private setBuildingStats(b: Building | null): void {
    const spec = b ? BUILDINGS[b.kind] : null;
    if (!b || !spec?.attack) {
      this.setStats(null);
      return;
    }
    const n = this.world.players.get(b.owner)?.researched.size ?? 0;
    this.showChips(`b:${b.kind}|${b.owner}|${n}`, () =>
      upgradedBuildingChips(spec, (stat, base) => statOf(this.world, b.owner, { building: b.kind }, stat, base))
    );
  }

  private showChips(key: string, chips: () => readonly { icon: string; text: string; title: string }[]): void {
    const el = this.el.stats;
    if (!el) return;
    setHidden(el, !key);
    if (key === this.statsKey) return;
    this.statsKey = key;
    el.replaceChildren();
    if (!key) return;
    for (const chip of chips()) {
      const span = document.createElement('span');
      span.className = 'stat-chip';
      span.title = chip.title;
      span.append(icon(chip.icon, 'stat-icon'), chip.text);
      el.append(span);
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
    const age = this.playerAge();
    this.affordKey = markAffordable(this.buildButtons, (k) => BUILDINGS[k].cost, this.world.stock, this.affordKey, (k) =>
      ageLockText(BUILDINGS[k].age, age)
    );
  }

  private updateTrainAffordable(): void {
    const age = this.playerAge();
    this.trainAffordKey = markAffordable(this.trainButtons, (k) => UNITS[k].cost, this.world.stock, this.trainAffordKey, (k) =>
      ageLockText(unitAge(k), age)
    );
  }

  private updateExplore(units: readonly Unit[]): void {
    const btn = this.el.explore;
    if (!btn) return;
    const show = showExplore(units);
    setHidden(btn, !show);
    const pressed = String(show && units.every((u) => u.state === 'exploring'));
    if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
  }

  private updateTrain(): void {
    const btn = this.el.train;
    if (!btn) return;
    const tc = this.world.townCenter;
    if (!tc) return;
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
    this.el.train?.animate(shake, { duration: 240, iterations: 1 });
  }

  private flashTrainGrid(): void {
    if (this.el.trainGrid && !this.el.trainGrid.hidden) this.el.trainGrid.animate(shake, { duration: 240, iterations: 1 });
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

const shake: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-5px)' },
  { transform: 'translateX(5px)' },
  { transform: 'translateX(0)' },
];

/** A build-menu style tile: icon, name, cost (with resource icons) and hotkey. */
function tile(iconHref: string, name: string, cost: Partial<Stockpile>, code: string | undefined, extra = ''): HTMLButtonElement {
  const key = keyLabel(code);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'build-btn';
  btn.title = `${name} — ${formatCost(cost)}${key ? ` (${key})` : ''}${extra ? `. ${extra}` : ''}`;
  btn.dataset.baseTitle = btn.title;
  btn.dataset.tip = btn.title;
  btn.setAttribute('aria-label', btn.title);
  btn.append(icon(iconHref, 'build-icon'));
  const label = document.createElement('span');
  label.className = 'build-name';
  label.textContent = name;
  btn.append(label);
  const costEl = document.createElement('span');
  costEl.className = 'build-cost';
  for (const e of costEntries(cost)) {
    const part = document.createElement('span');
    part.className = 'build-cost-part';
    part.dataset.res = e.type;
    part.append(icon(`#i-${e.type}`, 'cost-icon'), String(e.amount));
    costEl.append(part);
  }
  btn.append(costEl);
  const lock = document.createElement('span');
  lock.className = 'build-lock';
  btn.append(lock);
  if (key) {
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    btn.append(kbd);
  }
  return btn;
}

/** Sprite for a tech: the age glyph for age-ups, the scroll for everything else. */
function techIcon(tech: TechId): string {
  return TECHS[tech].ageUp !== undefined ? '#i-age' : '#i-tech';
}

/** A research tile: glyph, name, cost, time; greyed with the reason when it can't start. */
function techTile(e: TechEntry, fresh: boolean): HTMLButtonElement {
  const btn = tile(techIcon(e.tech), e.name, e.cost, undefined);
  btn.classList.add('train-tile', 'tech-tile');
  if (e.ageUp) btn.classList.add('age-tile');
  btn.dataset.research = e.tech;
  btn.dataset.locked = String(e.locked);
  btn.classList.toggle('locked', e.locked);
  btn.classList.toggle('unaffordable', e.unaffordable);
  btn.classList.toggle('fresh', fresh);
  btn.setAttribute('aria-disabled', String(e.locked || e.unaffordable));
  const tip = techTip(e.tech, formatCost(e.cost), e.reason);
  btn.title = tip;
  btn.dataset.tip = tip;
  btn.setAttribute('aria-label', tip);
  const time = document.createElement('span');
  time.className = 'tech-time';
  time.textContent = timeLabel(e.time);
  btn.querySelector('.build-cost')?.append(time);
  const lock = btn.querySelector<HTMLElement>('.build-lock');
  if (lock) lock.textContent = e.reason;
  for (const part of btn.querySelectorAll<HTMLElement>('.build-cost-part')) {
    part.classList.toggle('short', e.unaffordable && e.reason.includes(part.dataset.res ?? '-'));
  }
  return btn;
}

/**
 * Grey out tiles the stockpile can't pay for and mark the short resources. Only touches the
 * DOM when affordability changed; returns the new change key.
 */
function markAffordable<K>(
  buttons: ReadonlyMap<K, HTMLButtonElement>,
  costOf: (k: K) => Partial<Stockpile>,
  stock: Stockpile,
  prevKey: string,
  lockOf: (k: K) => string = () => ''
): string {
  let key = '';
  for (const k of buttons.keys()) {
    const cost = costOf(k);
    key += `${canAfford(cost, stock) ? '1' : '0'}${lockOf(k)}|`;
    for (const e of costEntries(cost)) key += stock[e.type] < e.amount ? 's' : '';
  }
  if (key === prevKey) return key;
  for (const [k, btn] of buttons) {
    const cost = costOf(k);
    const ok = canAfford(cost, stock);
    const lock = lockOf(k);
    btn.classList.toggle('unaffordable', !ok);
    btn.classList.toggle('locked', !!lock);
    btn.setAttribute('aria-disabled', String(!ok || !!lock));
    btn.dataset.locked = String(!!lock);
    const note = btn.querySelector<HTMLElement>('.build-lock');
    if (note) note.textContent = lock;
    const title = `${btn.dataset.baseTitle ?? ''}${lock ? `. ${lock}` : ''}`;
    btn.title = title;
    btn.dataset.tip = title;
    btn.setAttribute('aria-label', title);
    for (const part of btn.querySelectorAll<HTMLElement>('.build-cost-part')) {
      const type = part.dataset.res as ResourceType | undefined;
      part.classList.toggle('short', !!type && stock[type] < (cost[type] ?? 0));
    }
  }
  return key;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (el && el.hidden !== hidden) el.hidden = hidden;
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
