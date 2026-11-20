import { describe, expect, it } from 'vitest';
import { MAP_D, MAP_W } from '../core/types';
import { generateMap, startTurn } from './mapgen';

/**
 * Seat fairness (M16-11). The default map is one fixed landscape whose east start wins about 64%
 * of AI mirror matches, and seat 1 used to take the west start on every seed, so seat 2 won that
 * often. The seats now turn around the starts with the seed.
 */
describe('default map seats (M16-11)', () => {
  it('startTurn walks the seats around the starts, and seed 1 keeps the original layout', () => {
    expect([1, 2, 3, 4, 5, 6].map((seed) => startTurn(seed, 2))).toEqual([0, 1, 0, 1, 0, 1]);
    expect([1, 2, 3, 4, 5, 6].map((seed) => startTurn(seed, 3))).toEqual([0, 1, 2, 0, 1, 2]);
    expect([1, 2, 3, 4, 5].map((seed) => startTurn(seed, 4))).toEqual([0, 1, 2, 3, 0]);
    expect(startTurn(7, 1)).toBe(0);
    expect(startTurn(0, 2)).toBe(1);
    expect(startTurn(-3, 4)).toBe(0);
  });

  it('gives seat 1 the west start on odd seeds and the east start on even seeds', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { layout } = generateMap(seed, 2);
      const seat1 = layout.townCenter, seat2 = layout.extraStarts![0].townCenter;
      const west = seed % 2 === 1 ? seat1 : seat2, east = seed % 2 === 1 ? seat2 : seat1;
      expect(west.x).toBeLessThan(MAP_W / 2 - 40);
      expect(east.x).toBeGreaterThan(MAP_W / 2 + 40);
      // Still opposite each other across the middle of the map.
      expect((seat1.x + seat2.x) / 2).toBeCloseTo(MAP_W / 2, 0);
      expect((seat1.z + seat2.z) / 2).toBeCloseTo(MAP_D / 2, 0);
      // The villagers and the scout follow their Town Center.
      expect(layout.villagers[1]).toEqual({ x: seat1.x, z: seat1.z + 3.8 });
      expect(layout.extraStarts![0].scouts[0]).toEqual({ x: seat2.x - 4.2, z: seat2.z + 1.2 });
    }
  }, 30_000);

  it('turning the seats leaves the land as it was, so older saves regenerate the same scenery', () => {
    // Sums taken on main before the change (3ac53fc..7157fcc): resource nodes and scenery of seeds
    // whose seats now turn, for two, three and four players.
    const sum = (list: { pos: { x: number; z: number } }[]) => list.reduce((a, n) => a + Math.round(n.pos.x * 100) * 7 + Math.round(n.pos.z * 100) * 13, 0);
    const before = [
      { seed: 2, players: 2, nodes: 3469, nodeSum: 564128767, amount: 363200, props: 731, propSum: 123786601 },
      { seed: 4, players: 2, nodes: 3387, nodeSum: 552100578, amount: 355000, props: 683, propSum: 111254956 },
      { seed: 2, players: 3, nodes: 3995, nodeSum: 676062774, amount: 419875, props: 712, propSum: 117201353 },
      { seed: 2, players: 4, nodes: 3332, nodeSum: 538153045, amount: 357650, props: 691, propSum: 111789890 },
    ];
    for (const b of before) {
      const { layout } = generateMap(b.seed, b.players);
      expect({
        seed: b.seed, players: b.players, nodes: layout.nodes.length, nodeSum: sum(layout.nodes),
        amount: layout.nodes.reduce((a, n) => a + n.amount, 0), props: layout.props.length, propSum: sum(layout.props),
      }).toEqual(b);
    }
  }, 30_000);
});
