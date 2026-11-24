import { describe, expect, it } from 'vitest';
import { LAND_VERSION } from '../core/maps';
import { MAP_D, MAP_W, type Vec2 } from '../core/types';
import { generateMap } from './mapgen';
import { deserializeWorld, SAVE_VERSION, serializeWorld } from './serialize';
import { World, defaultPlayers } from './World';

/**
 * Start fairness (T119). The default map used to be one lopsided landscape: its east start had
 * fewer reachable berries, more gold and more stone close by, and won about 57% of AI mirror matches (69% for
 * Romans). With two players the land is now its west half turned half round the map centre onto
 * the east half, so the two starts are the same place.
 */
const image = (p: Vec2): Vec2 => ({ x: MAP_W - p.x, z: MAP_D - p.z });
const SEEDS = [1, 2, 3, 4, 7, 12];

describe('mirrored two-player land (T119)', () => {
  it.each(SEEDS)('seed %i: terrain, resources, scenery and animals are the same after a half-turn', (seed) => {
    const { hf, layout } = generateMap(seed, 2);
    let worst = 0;
    for (let z = 0.13; z < MAP_D; z += 0.71) {
      for (let x = 0.13; x < MAP_W / 2; x += 0.71) {
        const q = image({ x, z });
        worst = Math.max(worst, Math.abs(hf.heightAt(x, z) - hf.heightAt(q.x, q.z)), Math.abs(hf.forestDensity(x, z) - hf.forestDensity(q.x, q.z)));
        if (hf.isWalkable(x, z) !== hf.isWalkable(q.x, q.z) || hf.isWater(x, z) !== hf.isWater(q.x, q.z)) throw new Error(`walkability differs at ${x}, ${z}`);
      }
    }
    expect(worst).toBeLessThan(1e-9);
    const key = (kind: string, pos: Vec2, extra: number) => `${kind}:${pos.x.toFixed(6)}:${pos.z.toFixed(6)}:${extra}`;
    const nodes = new Set(layout.nodes.map((n) => key(n.kind, n.pos, n.amount)));
    expect(layout.nodes.filter((n) => !nodes.has(key(n.kind, image(n.pos), n.amount)))).toEqual([]);
    const props = new Set(layout.props.map((p) => key(p.kind, p.pos, p.blockRadius)));
    expect(layout.props.filter((p) => !props.has(key(p.kind, image(p.pos), p.blockRadius)))).toEqual([]);
    const animals = new Set(layout.animals!.map((a) => key(a.kind, a.pos, 0)));
    expect(layout.animals!.filter((a) => !animals.has(key(a.kind, image(a.pos), 0)))).toEqual([]);
    // Nothing sits on its own image: every item is one of a pair.
    expect(layout.nodes.length % 2).toBe(0);
    expect(layout.nodes.every((n) => Math.abs(n.pos.x - MAP_W / 2) > 0.5)).toBe(true);
  }, 30_000);

  it.each(SEEDS)('seed %i: the starts, their villagers and scouts are images of each other', (seed) => {
    const { layout } = generateMap(seed, 2);
    const other = layout.extraStarts![0];
    const close = (a: Vec2, b: Vec2) => { expect(a.x).toBeCloseTo(b.x, 9); expect(a.z).toBeCloseTo(b.z, 9); };
    close(other.townCenter, image(layout.townCenter));
    // A half-turn keeps the order of the three villagers.
    layout.villagers.forEach((v, i) => close(other.villagers[i], image(v)));
    close(other.scouts[0], image(layout.scouts[0]));
    // Seat 1 is still west on odd seeds and east on even ones (M16-11), and the west start is unturned.
    expect(layout.townCenter.x < MAP_W / 2).toBe(seed % 2 === 1);
    const west = layout.townCenter.x < MAP_W / 2 ? layout : other;
    expect(west.villagers[1]).toEqual({ x: west.townCenter.x, z: west.townCenter.z + 3.8 });
    expect(west.scouts[0]).toEqual({ x: west.townCenter.x - 4.2, z: west.townCenter.z + 1.2 });
  }, 30_000);

  it('both starts have the same resources within 30, 45 and 60 of the Town Center', () => {
    for (const seed of [1, 2, 5]) {
      const { layout } = generateMap(seed, 2);
      const starts = [layout.townCenter, layout.extraStarts![0].townCenter];
      for (const radius of [30, 45, 60]) {
        const [a, b] = starts.map((c) => {
          const total: Record<string, number> = {};
          for (const n of layout.nodes) if (Math.hypot(n.pos.x - c.x, n.pos.z - c.z) < radius - 1e-6) total[n.kind] = (total[n.kind] ?? 0) + n.amount;
          return total;
        });
        expect(a, `seed ${seed}, radius ${radius}`).toEqual(b);
      }
    }
  }, 30_000);

  it('both starting kits are complete: 20 trees, 7 berries, 2 gold and 2 stone within 24', () => {
    for (const seed of [1, 2]) {
      const { layout } = generateMap(seed, 2);
      for (const c of [layout.townCenter, layout.extraStarts![0].townCenter]) {
        const kit = layout.nodes.filter((n) => Math.hypot(n.pos.x - c.x, n.pos.z - c.z) < 24).map((n) => n.kind).sort().join(',');
        expect(kit).toBe([...Array(7).fill('berry'), 'gold', 'gold', 'stone', 'stone', ...Array(20).fill('tree')].join(','));
      }
    }
  }, 30_000);

  it('no neutral berries lie between 30 and 55 of a start', () => {
    // On land 1 the west start had a patch 42 away; the AI walked to it instead of farming and
    // laid its first field at minute 9-12, against minute 6 in the east.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { layout } = generateMap(seed, 2);
      for (const c of [layout.townCenter, layout.extraStarts![0].townCenter]) {
        const d = layout.nodes.filter((n) => n.kind === 'berry').map((n) => Math.hypot(n.pos.x - c.x, n.pos.z - c.z));
        expect(d.filter((x) => x >= 30 && x < 55), `seed ${seed}`).toEqual([]);
        expect(d.filter((x) => x < 30)).toHaveLength(14);
      }
      expect(layout.nodes.filter((n) => n.kind === 'berry')).toHaveLength(56);
    }
  }, 30_000);

  it('land 1 is still the old landscape, and three or four players keep it', () => {
    // Sums from main before T119 (2913290), as in mapgenSeats.test.ts before this change.
    const sum = (list: { pos: Vec2 }[]) => list.reduce((a, n) => a + Math.round(n.pos.x * 100) * 7 + Math.round(n.pos.z * 100) * 13, 0);
    const before = [
      { seed: 2, players: 2, land: 1, nodes: 3469, nodeSum: 564128767, amount: 363200, props: 731, propSum: 123786601 },
      { seed: 4, players: 2, land: 1, nodes: 3387, nodeSum: 552100578, amount: 355000, props: 683, propSum: 111254956 },
      { seed: 2, players: 3, land: LAND_VERSION, nodes: 3995, nodeSum: 676062774, amount: 419875, props: 712, propSum: 117201353 },
      { seed: 2, players: 4, land: LAND_VERSION, nodes: 3332, nodeSum: 538153045, amount: 357650, props: 691, propSum: 111789890 },
    ];
    for (const b of before) {
      const { layout } = generateMap(b.seed, b.players, {}, b.land);
      expect({
        seed: b.seed, players: b.players, land: b.land, nodes: layout.nodes.length, nodeSum: sum(layout.nodes),
        amount: layout.nodes.reduce((a, n) => a + n.amount, 0), props: layout.props.length, propSum: sum(layout.props),
      }).toEqual(b);
    }
  }, 30_000);

  it('a save records its land: older saves regenerate land 1, new ones land 2', () => {
    expect(LAND_VERSION).toBe(2);
    const make = (land: number) => {
      const { hf, layout } = generateMap(4, 2, {}, land);
      const world = new World(hf, layout, defaultPlayers(2));
      world.seed = 4;
      world.land = land;
      return world;
    };
    const fresh = serializeWorld(make(LAND_VERSION));
    expect(fresh.version).toBe(SAVE_VERSION);
    expect(fresh.land).toBe(2);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(fresh)));
    expect(loaded.land).toBe(2);
    expect(loaded.hf.heightAt(150, 150)).toBe(generateMap(4, 2).hf.heightAt(150, 150));
    // The old lake: water on land 1, dry ground on the mirrored land.
    expect(generateMap(4, 2, {}, 1).hf.isWater(150, 150)).toBe(true);
    expect(loaded.hf.isWater(150, 150)).toBe(false);

    // A version 16 save has no `land` field and was made on land 1.
    const old = { ...serializeWorld(make(1)), version: 16 };
    delete old.land;
    const restored = deserializeWorld(JSON.parse(JSON.stringify(old)));
    expect(restored.land).toBe(1);
    expect(restored.hf.isWater(150, 150)).toBe(true);
    expect(restored.nodes.size).toBe(make(1).nodes.size);
    // Saved again, it stays on land 1.
    const again = serializeWorld(restored);
    expect(again.land).toBe(1);
    expect(deserializeWorld(JSON.parse(JSON.stringify(again))).hf.isWater(150, 150)).toBe(true);
    for (const land of [0, -1, 1.5, 3, NaN, Infinity, '2']) {
      expect(() => deserializeWorld({ ...JSON.parse(JSON.stringify(fresh)), land }), String(land)).toThrow('land version');
    }
  }, 60_000);
});
