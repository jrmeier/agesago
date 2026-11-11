import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { qualityTier } from '../core/quality';
import { GRASS_ONLY, SEA_LEVEL, type Heightfield, type MapLayout, type Vec2 } from '../core/types';
import { generateMap } from '../sim/mapgen';
import { completeBuilding, layFoundation } from '../sim/systems/build';
import { EXPLORED, UNEXPLORED, VISIBLE } from '../sim/visibility';
import { defaultPlayers, World } from '../sim/World';
import { paintTerritory, TERRITORY_ALPHA } from '../ui/minimapMath';
import {
  extractBorders,
  isBorderCell,
  rememberTerritory,
  TerritoryMemory,
  UNSEEN,
  type BorderEdge,
} from './territoryBorders';
import { borderProfile, buildBorderMesh, TerritoryView } from './TerritoryView';

/** `rows` strings of digits, '.' = UNSEEN. */
function grid(...rows: string[]): { known: Uint8Array; cols: number; rows: number } {
  const cols = rows[0].length;
  const known = new Uint8Array(cols * rows.length);
  rows.forEach((r, z) => [...r].forEach((ch, x) => (known[z * cols + x] = ch === '.' ? UNSEEN : Number(ch))));
  return { known, cols, rows: rows.length };
}

/** Sight grid from a string per row: '#' visible, '+' explored, ' ' unexplored. */
function sight(...rows: string[]) {
  const state = (ch: string) => (ch === '#' ? VISIBLE : ch === '+' ? EXPLORED : UNEXPLORED);
  return {
    version: 0,
    rows,
    stateAt(x: number, z: number) {
      return state(this.rows[Math.floor(z)]?.[Math.floor(x)] ?? ' ');
    },
  };
}

const key = (e: BorderEdge) => `${e.owner}@${e.x},${e.z},${e.axis},${e.nx},${e.nz}`;

describe('border extraction (M18-2)', () => {
  it('outlines a single owned cell with four inward edges', () => {
    const g = grid('000', '010', '000');
    const edges = extractBorders(g.known, g.cols, g.rows).map(key).sort();
    expect(edges).toEqual(['1@1,1,0,0,1', '1@1,1,1,1,0', '1@1,2,0,0,-1', '1@2,1,1,-1,0'].sort());
  });

  it('draws one line inside each side where two players meet, none inside a region', () => {
    const g = grid('1122', '1122');
    const edges = extractBorders(g.known, g.cols, g.rows);
    expect(edges).toHaveLength(4);
    for (const e of edges) {
      expect(e.x).toBe(2);
      expect(e.axis).toBe(1);
      // The inward normal points into the owner's cells.
      expect(e.nx).toBe(e.owner === 1 ? -1 : 1);
    }
  });

  it('draws nothing along unexplored cells or the map edge', () => {
    // Player 1 runs off the explored area on the right and off the map at the top.
    const g = grid('11..', '11..', '000.');
    const edges = extractBorders(g.known, g.cols, g.rows);
    expect(edges.map(key).sort()).toEqual(['1@0,2,0,0,-1', '1@1,2,0,0,-1']);
    expect(extractBorders(grid('....', '....').known, 4, 2)).toEqual([]);
  });

  it('flags border cells for the minimap tint', () => {
    const g = grid('0000', '0110', '0110', '0000');
    expect(isBorderCell(g.known, 4, 4, 5)).toBe(true);
    expect(isBorderCell(g.known, 4, 4, 0)).toBe(false);
    const big = grid('11111', '11111', '11111');
    expect(isBorderCell(big.known, 5, 3, 7)).toBe(false);
  });
});

describe('remembered territory follows the fog (M18-2)', () => {
  const live = (...rows: string[]) => {
    const g = grid(...rows);
    return { cols: g.cols, rows: g.rows, cell: 1, owner: g.known };
  };

  it('hides unexplored cells and shows visible ones live', () => {
    const known = new Uint8Array(3).fill(UNSEEN);
    rememberTerritory(known, live('122'), sight('# #'), 1);
    expect([...known]).toEqual([1, UNSEEN, 2]);
  });

  it('keeps an enemy border as last seen until it is visible again', () => {
    const known = new Uint8Array(2).fill(UNSEEN);
    rememberTerritory(known, live('20'), sight('##'), 1);
    expect([...known]).toEqual([2, 0]);
    // The enemy grows and shrinks out of sight: the memory does not move.
    expect(rememberTerritory(known, live('02'), sight('++'), 1)).toBe(false);
    expect([...known]).toEqual([2, 0]);
    rememberTerritory(known, live('02'), sight('#+'), 1);
    expect([...known]).toEqual([0, 0]);
  });

  it('always knows its own land, and loses it to neutral (not to the taker) in the fog', () => {
    const known = new Uint8Array(2).fill(UNSEEN);
    rememberTerritory(known, live('11'), sight('##'), 1);
    rememberTerritory(known, live('12'), sight('++'), 1);
    expect([...known]).toEqual([1, 0]);
    rememberTerritory(known, live('21'), sight('++'), 1);
    expect([...known]).toEqual([0, 1]);
  });

  it('TerritoryMemory rescans only on a version change and bumps its own version only on a change', () => {
    const territory = { ...live('11'), version: 0 };
    const fog = sight('##');
    const memory = new TerritoryMemory(territory, fog, 1);
    expect(memory.update()).toBe(true);
    expect(memory.version).toBe(1);
    expect(memory.pending).toBe(false);
    expect(memory.update()).toBe(false);
    fog.version++;
    expect(memory.pending).toBe(true);
    expect(memory.update()).toBe(false); // nothing new to remember
    expect(memory.version).toBe(1);
    territory.owner[1] = 0;
    territory.version++;
    expect(memory.territoryChanged).toBe(true);
    expect(memory.update()).toBe(true);
    expect(memory.version).toBe(2);
  });
});

describe('border mesh (M18-2)', () => {
  const hf = { heightAt: (x: number) => (x > 5 ? -2 : 1.5) };
  const white = () => new THREE.Color(1, 1, 1);

  it('drapes a quad per edge over the heightfield, floating above water', () => {
    const edges: BorderEdge[] = [
      { owner: 1, x: 2, z: 3, axis: 0, nx: 0, nz: 1 },
      { owner: 2, x: 7, z: 0, axis: 1, nx: -1, nz: 0 },
    ];
    const m = buildBorderMesh(edges, 1, 0.5, hf, white);
    expect(m.positions).toHaveLength(2 * 4 * 3);
    expect(m.indices).toHaveLength(2 * 6);
    // First quad: edge from (2,3) to (3,3), inward to z = 3.5, on land.
    expect([...m.positions.slice(0, 3)]).toEqual([2, expect.closeTo(1.58, 5), 3]);
    expect(m.positions[3 * 3 + 2]).toBeCloseTo(3.5);
    // Second quad sits over water: above the sea, not on the bed.
    expect(m.positions[4 * 3 + 1]).toBeGreaterThan(SEA_LEVEL);
    expect(m.positions[6 * 3]).toBeCloseTo(6.5);
    // v = 0 on the border line, 1 inside.
    expect([...m.uvs.slice(0, 8)]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it('glow profile has a bright core and a soft tail; the phone profile stops hard', () => {
    const glow = borderProfile(true);
    const plain = borderProfile(false);
    const alpha = (d: Uint8Array, i: number) => d[i * 4 + 3];
    expect(alpha(glow, 0)).toBeGreaterThan(200);
    expect(alpha(glow, 31)).toBeLessThan(10);
    expect(alpha(glow, 16)).toBeGreaterThan(alpha(glow, 28));
    expect(alpha(plain, 16)).toBeGreaterThan(200);
  });
});

describe('minimap owner tint (M18-2)', () => {
  it('washes owned cells, strengthens border cells, leaves neutral and unexplored clear', () => {
    const g = grid('0110', '0110', '..00');
    const out = new Uint8ClampedArray(g.cols * g.rows * 4);
    const known = g.known;
    paintTerritory(known, g.cols, g.rows, () => [10, 20, 30], out, (i) => isBorderCell(known, g.cols, g.rows, i));
    expect([...out.slice(4, 8)]).toEqual([10, 20, 30, TERRITORY_ALPHA.edge]);
    expect(out[3]).toBe(0);
    expect(out[8 * 4 + 3]).toBe(0);
    const solid = grid('111', '111', '111');
    const out2 = new Uint8ClampedArray(9 * 4);
    paintTerritory(solid.known, 3, 3, () => [1, 2, 3], out2, (i) => isBorderCell(solid.known, 3, 3, i));
    expect(out2[4 * 4 + 3]).toBe(TERRITORY_ALPHA.fill);
  });
});

function flat(w = 80, d = 80): Heightfield {
  return {
    width: w,
    depth: d,
    heightAt: () => 0.5,
    isWater: () => false,
    isWalkable: (x, z) => x >= 0 && z >= 0 && x <= w && z <= d,
    forestDensity: () => 0,
    ground: () => GRASS_ONLY,
  };
}

function arena(tcs: Vec2[], hf = flat()): World {
  const [first, ...rest] = tcs;
  const layout: MapLayout = {
    townCenter: first,
    villagers: [],
    scouts: [],
    extraStarts: rest.map((townCenter) => ({ townCenter, villagers: [], scouts: [] })),
    nodes: [],
    props: [],
  };
  return new World(hf, layout, defaultPlayers(tcs.length));
}

describe('TerritoryView (M18-2)', () => {
  const color = (o: number) => [0, 0x2f6fb5, 0xb23a32][o] ?? 0x999999;

  it('builds borders from the world and rebuilds only when territory or colours change', () => {
    const world = arena([{ x: 40, z: 40 }]);
    world.visibility.update([{ pos: { x: 40, z: 40 }, sight: 60 }]);
    const view = new TerritoryView(world.hf, world.territory, world.visibility, 1, qualityTier('high'), color);
    view.update(0);
    expect(view.builds).toBe(1);
    expect(view.object.visible).toBe(true);
    const verts = view.object.geometry.getAttribute('position').count;
    expect(verts).toBeGreaterThan(0);
    // Idle frames do no work.
    for (let t = 1; t < 10; t++) view.update(t);
    expect(view.builds).toBe(1);
    // A new house grows the border: one rebuild.
    const house = layFoundation(world, 'house', { x: 40 + 21, z: 40 }, 0, 1);
    completeBuilding(world, house);
    world.territory.sync(world);
    view.update(10);
    expect(view.builds).toBe(2);
    expect(view.object.geometry.getAttribute('position').count).not.toBe(verts);
  });

  it('shows nothing of territory the player has not explored', () => {
    const world = arena([{ x: 20, z: 40 }, { x: 60, z: 40 }]);
    world.visibility.update([{ pos: { x: 20, z: 40 }, sight: 8 }]);
    const view = new TerritoryView(world.hf, world.territory, world.visibility, 1, qualityTier('high'), color);
    view.update(0);
    const pos = view.object.geometry.getAttribute('position');
    // Every vertex lies within the explored disc (plus the ribbon width); the enemy's is hidden.
    for (let i = 0; i < pos.count; i++) expect(Math.hypot(pos.getX(i) - 20, pos.getZ(i) - 40)).toBeLessThan(10);
  });

  it('hides and skips work when the setting is off; phones use the plain line', () => {
    const world = arena([{ x: 40, z: 40 }]);
    world.visibility.update([{ pos: { x: 40, z: 40 }, sight: 60 }]);
    const view = new TerritoryView(world.hf, world.territory, world.visibility, 1, qualityTier('low'), color);
    view.setShown(false);
    view.update(0);
    expect(view.builds).toBe(0);
    expect(view.object.visible).toBe(false);
    view.setShown(true);
    view.update(1);
    expect(view.builds).toBe(1);
    expect(view.object.visible).toBe(true);
    const tex = (view.object.material as THREE.MeshBasicMaterial).map as THREE.DataTexture;
    expect((tex.image.data as Uint8Array)[16 * 4 + 3]).toBeGreaterThan(200); // plain: solid mid-ribbon
  });

  it('bench: a full rebuild on the largest map stays under 4 ms', () => {
    const { hf, layout } = generateMap(1, 4, { size: 'giant' });
    const world = new World(hf, layout);
    for (const [id, p] of world.players) {
      p.age = 3;
      const c = world.townCenterOf(id)!.pos;
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2 * 2;
        const r = 10 + (i % 20) * 2;
        const pos = world.nav.nearestFree({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }) ?? c;
        completeBuilding(world, layFoundation(world, i % 3 ? 'house' : 'barracks', pos, 0, id));
      }
    }
    world.territory.recompute(world);
    // Worst case: the whole map explored and visible.
    world.visibility.update([{ pos: { x: hf.width / 2, z: hf.depth / 2 }, sight: hf.width }]);
    const view = new TerritoryView(hf, world.territory, world.visibility, 1, qualityTier('high'), (o) => 0x111111 * o);
    let best = Infinity;
    for (let i = 0; i < 8; i++) {
      world.territory.version++; // force the memory rescan and a rebuild each round
      view.memory.known.fill(UNSEEN);
      const t0 = performance.now();
      view.update(i);
      best = Math.min(best, performance.now() - t0);
    }
    const edges = view.object.geometry.getAttribute('position').count / 4;
    console.log(`territory borders, giant map, 4 players: rescan + rebuild ${best.toFixed(3)} ms, ${edges} edges`);
    expect(edges).toBeGreaterThan(100);
    expect(best).toBeLessThan(4);
  });
});
