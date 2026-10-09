import { describe, expect, it } from 'vitest';
import { GestureRecognizer, LONG_PRESS_MS, TAP_MAX_MOVE_PX, TAP_MAX_MS, type GestureEvent } from './gestures';

const types = (es: GestureEvent[]) => es.map((e) => e.type);

describe('GestureRecognizer: one finger', () => {
  it('a quick, still press is a tap at the press point', () => {
    const g = new GestureRecognizer();
    expect(g.down(1, 100, 200, 0)).toEqual([]);
    expect(g.move(1, 104, 203, 50)).toEqual([]);
    expect(g.up(1, 106, 205, 120)).toEqual([{ type: 'tap', x: 100, y: 200 }]);
    expect(g.count).toBe(0);
  });

  it('tolerates exactly the tap slop, not more', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(types(g.up(1, TAP_MAX_MOVE_PX, 0, 100))).toEqual(['tap']);
    g.down(2, 0, 0, 1000);
    expect(types(g.up(2, TAP_MAX_MOVE_PX + 1, 0, 1100))).toEqual([]);
  });

  it('a press held too long for a tap but short of a long-press does nothing', () => {
    const g = new GestureRecognizer();
    g.down(1, 10, 10, 0);
    expect(g.tick(TAP_MAX_MS + 50)).toEqual([]);
    expect(g.up(1, 10, 10, TAP_MAX_MS + 50)).toEqual([]);
  });

  it('dragging pans: panStart at the press point, then pan samples, then panEnd', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 105, 100, 16)).toEqual([]);
    expect(g.move(1, 120, 100, 32)).toEqual([
      { type: 'panStart', x: 100, y: 100 },
      { type: 'pan', x: 120, y: 100 },
    ]);
    expect(g.move(1, 150, 90, 48)).toEqual([{ type: 'pan', x: 150, y: 90 }]);
    // Panning never becomes a long-press, however long it lasts.
    expect(g.tick(2000)).toEqual([]);
    expect(g.up(1, 150, 90, 2000)).toEqual([{ type: 'panEnd' }]);
  });

  it('a fast flick that lifts within tap time is still a pan, not a tap', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.move(1, 40, 0, 30);
    expect(types(g.up(1, 60, 0, 60))).toEqual(['panEnd']);
  });
});

describe('GestureRecognizer: long-press', () => {
  it('fires once from tick after LONG_PRESS_MS of stillness', () => {
    const g = new GestureRecognizer();
    g.down(1, 50, 60, 1000);
    expect(g.tick(1000 + LONG_PRESS_MS - 1)).toEqual([]);
    expect(g.tick(1000 + LONG_PRESS_MS)).toEqual([{ type: 'longPress', x: 50, y: 60 }]);
    expect(g.tick(1000 + LONG_PRESS_MS + 100)).toEqual([]);
  });

  it('release without moving is a longPressTap', () => {
    const g = new GestureRecognizer();
    g.down(1, 50, 60, 0);
    g.tick(LONG_PRESS_MS);
    g.move(1, 55, 62, LONG_PRESS_MS + 20);
    expect(g.up(1, 55, 62, 900)).toEqual([{ type: 'longPressTap', x: 50, y: 60 }]);
  });

  it('a long-press missed by tick is reported on release', () => {
    const g = new GestureRecognizer();
    g.down(1, 5, 5, 0);
    expect(types(g.up(1, 5, 5, LONG_PRESS_MS + 10))).toEqual(['longPress', 'longPressTap']);
  });

  it('long-press then drag is a box from the press point', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    g.tick(500);
    expect(g.move(1, 105, 105, 520)).toEqual([]);
    expect(g.move(1, 160, 140, 540)).toEqual([{ type: 'box', x0: 100, y0: 100, x: 160, y: 140 }]);
    expect(g.move(1, 200, 180, 560)).toEqual([{ type: 'box', x0: 100, y0: 100, x: 200, y: 180 }]);
    // Moving back inside the slop keeps boxing.
    expect(types(g.move(1, 101, 101, 580))).toEqual(['box']);
    expect(g.up(1, 220, 190, 600)).toEqual([{ type: 'boxEnd', x0: 100, y0: 100, x: 220, y: 190 }]);
  });

  it('a long-press detected on a move sample (no tick) still leads to a box', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(types(g.move(1, 50, 0, LONG_PRESS_MS + 5))).toEqual(['longPress', 'box']);
  });

  it('cancel aborts a box without selecting', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.tick(500);
    g.move(1, 50, 50, 510);
    expect(g.cancel(1)).toEqual([{ type: 'boxCancel' }]);
    expect(g.count).toBe(0);
  });

  it('cancel of a still press produces no tap', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(g.cancel(1)).toEqual([]);
  });
});

describe('GestureRecognizer: two fingers', () => {
  it('a second finger re-anchors at the midpoint; moving apart pinches out about the midpoint', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    expect(g.down(2, 200, 100, 10)).toEqual([{ type: 'panStart', x: 150, y: 100 }]);
    expect(g.move(2, 300, 100, 30)).toEqual([
      { type: 'pan', x: 200, y: 100 },
      { type: 'pinch', x: 200, y: 100, scale: 2 },
    ]);
    expect(g.move(1, 50, 100, 40)).toEqual([
      { type: 'pan', x: 175, y: 100 },
      { type: 'pinch', x: 175, y: 100, scale: 1.25 },
    ]);
  });

  it('pinch scales compose to the overall spread ratio', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 0);
    let total = 1;
    for (const x of [90, 80, 60, 50]) {
      for (const e of g.move(2, x, 0, 10)) if (e.type === 'pinch') total *= e.scale;
    }
    expect(total).toBeCloseTo(0.5);
  });

  it('two fingers moving together pan with no net zoom', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 0);
    expect(g.move(1, 110, 130, 10).concat(g.move(2, 210, 130, 20)).reduce((k, e) => (e.type === 'pinch' ? k * e.scale : k), 1)).toBeCloseTo(1);
    expect(g.move(1, 120, 160, 30)).toEqual([{ type: 'pan', x: 165, y: 145 }, expect.objectContaining({ type: 'pinch' })]);
    expect(g.move(2, 220, 160, 40)[0]).toEqual({ type: 'pan', x: 170, y: 160 });
    // A sample that leaves the spread unchanged emits no pinch.
    expect(g.move(2, 220, 160, 50)).toEqual([{ type: 'pan', x: 170, y: 160 }]);
  });

  it('turns a one-finger pan into a two-finger gesture', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.move(1, 40, 0, 10);
    expect(types(g.down(2, 140, 0, 20))).toEqual(['panStart']);
  });

  it('a second finger cancels a box', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.tick(500);
    g.move(1, 50, 50, 510);
    expect(types(g.down(2, 200, 200, 520))).toEqual(['boxCancel', 'panStart']);
  });

  it('a quick two-finger touch is never a tap; lifting one finger keeps panning with the other', () => {
    const g = new GestureRecognizer();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 10);
    expect(g.up(1, 100, 100, 50)).toEqual([{ type: 'panStart', x: 200, y: 100 }]);
    expect(g.move(2, 240, 100, 60)).toEqual([{ type: 'pan', x: 240, y: 100 }]);
    expect(g.up(2, 240, 100, 80)).toEqual([{ type: 'panEnd' }]);
  });

  it('ignores a third finger until one of the pair lifts', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 0);
    expect(g.down(3, 500, 500, 0)).toEqual([]);
    expect(g.move(3, 600, 600, 10)).toEqual([]);
    expect(g.up(3, 600, 600, 20)).toEqual([]);
    g.down(4, 300, 0, 30);
    expect(g.up(1, 0, 0, 40)).toEqual([{ type: 'panStart', x: 200, y: 0 }]);
  });

  it('a pinch step is bounded so one glitchy sample cannot zoom wildly', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.down(2, 1, 0, 0);
    const pinch = g.move(2, 500, 0, 10).find((e) => e.type === 'pinch');
    expect(pinch && pinch.type === 'pinch' && pinch.scale).toBe(2);
  });
});

describe('GestureRecognizer: reset', () => {
  it('ends an in-progress pan and forgets all pointers', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.move(1, 50, 0, 10);
    expect(g.reset()).toEqual([{ type: 'panEnd' }]);
    expect(g.count).toBe(0);
    expect(g.move(1, 80, 0, 20)).toEqual([]);
    expect(g.up(1, 80, 0, 30)).toEqual([]);
  });

  it('cancels a box', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    g.tick(500);
    g.move(1, 50, 50, 510);
    expect(g.reset()).toEqual([{ type: 'boxCancel' }]);
  });

  it('clears an armed box', () => {
    const g = new GestureRecognizer();
    g.armBox();
    expect(g.boxArmed).toBe(true);
    expect(g.reset()).toEqual([]);
    expect(g.boxArmed).toBe(false);
  });

  it('ignores duplicate downs and unknown pointers', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(g.down(1, 30, 30, 5)).toEqual([]);
    expect(g.move(9, 30, 30, 5)).toEqual([]);
    expect(g.up(9, 30, 30, 5)).toEqual([]);
    expect(types(g.up(1, 0, 0, 50))).toEqual(['tap']);
  });
});

describe('GestureRecognizer: armed box', () => {
  it('an armed drag is a box from the press point, not a pan', () => {
    const g = new GestureRecognizer();
    g.armBox();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 130, 140, 40)).toEqual([{ type: 'box', x0: 100, y0: 100, x: 130, y: 140 }]);
    expect(g.boxArmed).toBe(false);
    expect(g.up(1, 160, 150, 80)).toEqual([{ type: 'boxEnd', x0: 100, y0: 100, x: 160, y: 150 }]);
  });

  it('an armed tap cancels the arm and is not a tap', () => {
    const g = new GestureRecognizer();
    g.armBox();
    g.down(1, 10, 20, 0);
    expect(g.up(1, 12, 22, 100)).toEqual([{ type: 'armCancel' }]);
    expect(g.boxArmed).toBe(false);
  });

  it('an unarmed drag still pans', () => {
    const g = new GestureRecognizer();
    g.down(1, 0, 0, 0);
    expect(types(g.move(1, 40, 0, 20))).toEqual(['panStart', 'pan']);
  });

  it('disarming before the drag pans again', () => {
    const g = new GestureRecognizer();
    g.armBox();
    g.down(1, 0, 0, 0);
    g.disarmBox();
    expect(types(g.move(1, 40, 0, 20))).toEqual(['panStart', 'pan']);
  });

  it('a second finger clears the arm', () => {
    const g = new GestureRecognizer();
    g.armBox();
    g.down(1, 0, 0, 0);
    expect(g.down(2, 80, 0, 10)).toEqual([
      { type: 'armCancel' },
      { type: 'panStart', x: 40, y: 0 },
    ]);
    expect(g.boxArmed).toBe(false);
  });
});
