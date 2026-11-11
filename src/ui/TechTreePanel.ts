import { CIVS } from '../core/civilizations';
import type { TechId } from '../core/techs';
import type { BuildingKind, PlayerId } from '../core/types';
import { ageBuildings } from '../sim/systems/research';
import type { World } from '../sim/World';
import { techTreeModel, type TreeEntry, type TreeInput } from './techTree';

/** What the tech tree needs to know about `owner`, read from the world. */
export function treeInputFor(world: World, owner: PlayerId): TreeInput {
  const p = world.players.get(owner);
  const age = p?.age ?? 0;
  const built = new Set<BuildingKind>();
  const queued = new Set<TechId>();
  for (const b of world.buildings.values()) {
    if (b.owner !== owner) continue;
    if (b.complete) built.add(b.kind);
    for (const t of b.research ?? []) queued.add(t);
  }
  return {
    civ: p?.player.civ,
    age,
    researched: p?.researched ?? new Set(),
    queued,
    built,
    ageBuildings: ageBuildings(world, owner, age).length,
  };
}

const GROUPS = [
  ['buildings', 'Buildings'],
  ['units', 'Units'],
  ['techs', 'Technologies'],
] as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tile(e: TreeEntry): HTMLLIElement {
  const li = el('li', 'tt-tile');
  li.dataset.state = e.state;
  li.dataset.id = e.id;
  const head = el('div', 'tt-head');
  head.append(el('strong', 'tt-name', e.name), el('span', 'tt-badge', e.badge));
  li.append(head, el('span', 'tt-line', e.source));
  if (e.reason) li.append(el('span', 'tt-line tt-reason', e.reason));
  if (e.unlocks.length) li.append(el('span', 'tt-line tt-unlocks', `Unlocks: ${e.unlocks.join(', ')}`));
  return li;
}

/**
 * The full-screen tech tree (#tech-tree). Opened by #tech-tree-btn, the W hotkey (Controls) and,
 * on touch, the button in the Menu sheet. Game pauses single-player matches while it is open.
 */
export class TechTreePanel {
  private readonly root: HTMLElement | null;
  private readonly btn: HTMLButtonElement | null;

  constructor(private readonly input: () => TreeInput) {
    this.root = document.getElementById('tech-tree');
    this.btn = document.getElementById('tech-tree-btn') as HTMLButtonElement | null;
    this.btn?.addEventListener('click', () => this.toggle());
    document.getElementById('tech-tree-close')?.addEventListener('click', () => this.close());
    this.root?.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
  }

  get open(): boolean {
    return !!this.root && !this.root.hidden;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (!this.root) return;
    this.render();
    this.root.hidden = false;
    this.btn?.setAttribute('aria-expanded', 'true');
    document.getElementById('tech-tree-close')?.focus();
  }

  close(): void {
    if (!this.root || this.root.hidden) return;
    this.root.hidden = true;
    this.btn?.setAttribute('aria-expanded', 'false');
  }

  /** Rebuild the age sections from the current player state. */
  render(): void {
    const body = document.getElementById('tech-tree-body');
    if (!body) return;
    const input = this.input();
    const civ = document.getElementById('tech-tree-civ');
    if (civ) civ.textContent = input.civ ? CIVS[input.civ].name : '';
    body.replaceChildren();
    for (const age of techTreeModel(input)) {
      const section = el('section', 'tt-age');
      section.dataset.age = String(age.age);
      if (age.current) section.dataset.current = 'true';
      const heading = el('h3', 'tt-age-title', age.name);
      if (age.current) heading.append(el('span', 'tt-current', 'Current'));
      section.append(heading);
      for (const [key, label] of GROUPS) {
        const entries = age[key];
        if (!entries.length) continue;
        section.append(el('h4', 'tt-group', label));
        const list = el('ul', 'tt-grid');
        list.append(...entries.map(tile));
        section.append(list);
      }
      body.append(section);
    }
  }
}
