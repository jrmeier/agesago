import { describe, expect, it } from 'vitest';
import { EXPLORED, UNEXPLORED, VISIBLE, Visibility } from '../sim/visibility';
import { fogColor, nodeAlpha, paintFog } from './fog';

const lum = (c: readonly number[]) => c[0] + c[1] + c[2];

describe('minimap fog colours', () => {
  it('blacks out unexplored cells completely', () => {
    const c = fogColor(UNEXPLORED);
    expect(c[3]).toBe(255);
    expect(lum(c)).toBeLessThan(90);
  });

  it('dims and desaturates explored cells without hiding them', () => {
    const c = fogColor(EXPLORED);
    expect(c[3]).toBeGreaterThan(60);
    expect(c[3]).toBeLessThan(220);
    // A near-grey wash: channels close together, so it pulls colours toward grey.
    expect(Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])).toBeLessThan(20);
  });

  it('leaves visible cells clear and treats unknown states as unexplored', () => {
    expect(fogColor(VISIBLE)[3]).toBe(0);
    expect(fogColor(7)).toEqual(fogColor(UNEXPLORED));
  });

  it('paints one RGBA pixel per visibility cell', () => {
    const v = new Visibility(8, 6);
    v.update([{ pos: { x: 2, z: 2 }, sight: 1.5 }]);
    v.update([]);
    v.update([{ pos: { x: 6.5, z: 4.5 }, sight: 0.8 }]);
    const out = new Uint8ClampedArray(v.cols * v.rows * 4);
    paintFog(v.state, out);
    const alphaAt = (x: number, z: number) => out[(Math.floor(z) * v.cols + Math.floor(x)) * 4 + 3];
    expect(alphaAt(6.5, 4.5)).toBe(fogColor(VISIBLE)[3]);
    expect(alphaAt(2, 2)).toBe(fogColor(EXPLORED)[3]);
    expect(alphaAt(0, 5)).toBe(255);
  });

  it('hides resource dots in the black and fades remembered ones', () => {
    expect(nodeAlpha(UNEXPLORED)).toBe(0);
    expect(nodeAlpha(EXPLORED)).toBeGreaterThan(0);
    expect(nodeAlpha(EXPLORED)).toBeLessThan(1);
    expect(nodeAlpha(VISIBLE)).toBe(1);
  });
});
