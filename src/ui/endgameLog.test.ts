import { describe, expect, it } from 'vitest';
import {
  MAX_SAMPLES,
  SAMPLE_EVERY,
  EndgameLog,
  chartPoints,
  formatChartValue,
  plotPoints,
  pointsAttr,
  summaryText,
  type EndgameSample,
} from './endgameLog';

function at(time: number, food = 0, extra: Partial<EndgameSample> = {}): EndgameSample {
  return { time, food, wood: 1, gold: 2, stone: 3, population: 4, explored: 0.25, ...extra };
}

describe('endgame sampler', () => {
  it('records on the interval, ignores calls inside it, and forces the game-over reading', () => {
    const log = new EndgameLog();
    expect(log.shouldSample(0)).toBe(true);
    expect(log.record(at(0, 5))).toBe(true);
    expect(log.shouldSample(SAMPLE_EVERY - 0.01)).toBe(false);
    expect(log.record(at(SAMPLE_EVERY - 0.01, 9))).toBe(false);
    expect(log.samples).toHaveLength(1);

    expect(log.shouldSample(SAMPLE_EVERY)).toBe(true);
    expect(log.record(at(SAMPLE_EVERY, 10))).toBe(true);
    expect(log.samples.map((s) => s.food)).toEqual([5, 10]);

    expect(log.record(at(SAMPLE_EVERY, 11), true)).toBe(true);
    expect(log.samples).toHaveLength(2);
    expect(log.samples[1].food).toBe(11);

    expect(log.record(at(SAMPLE_EVERY + 2, 12), true)).toBe(true);
    expect(log.samples.map((s) => s.time)).toEqual([0, SAMPLE_EVERY, SAMPLE_EVERY + 2]);
  });

  it('copies samples so a later mutation does not change the log', () => {
    const log = new EndgameLog();
    const sample = at(0, 3);
    log.record(sample);
    sample.food = 99;
    expect(log.samples[0].food).toBe(3);
  });

  it('keeps at most a few hundred samples, including the start and the latest', () => {
    const log = new EndgameLog();
    const n = MAX_SAMPLES + 40;
    for (let i = 0; i < n; i++) log.record(at(i * SAMPLE_EVERY, i));
    expect(log.samples.length).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(log.samples.length).toBeGreaterThan(MAX_SAMPLES / 2);
    expect(log.samples[0].time).toBe(0);
    expect(log.samples[log.samples.length - 1].food).toBe(n - 1);
    for (let i = 1; i < log.samples.length; i++) {
      expect(log.samples[i].time).toBeGreaterThan(log.samples[i - 1].time);
    }
  });
});

describe('chart points', () => {
  const samples: EndgameSample[] = [
    at(10, 0, { wood: 5, gold: 5, stone: 1, population: 3, explored: 0.1 }),
    at(20, 50, { wood: 5, gold: 1, stone: 9, population: 7, explored: 0.6 }),
    at(40, 100, { wood: 5, gold: 9, stone: 9, population: 3, explored: 0.6 }),
  ];

  it('maps time across the match and each series onto 0..1', () => {
    const food = chartPoints(samples, 'food');
    expect(food).toHaveLength(3);
    expect(food[0]).toEqual({ x: 0, y: 0 });
    expect(food[1].x).toBeCloseTo(1 / 3);
    expect(food[1].y).toBeCloseTo(0.5);
    expect(food[2]).toEqual({ x: 1, y: 1 });

    const gold = chartPoints(samples, 'gold');
    expect(gold[0].y).toBeCloseTo(0.5);
    expect(gold[1].y).toBe(0);
    expect(gold[2].y).toBe(1);

    expect(chartPoints(samples, 'wood').every((p) => p.y === 0.5)).toBe(true);
    expect(chartPoints(samples, 'population').map((p) => p.y)).toEqual([0, 1, 0]);
    expect(chartPoints(samples, 'explored').map((p) => p.y)).toEqual([0, 1, 1]);
  });

  it('returns nothing for an empty log and centers a single flat point', () => {
    expect(chartPoints([], 'food')).toEqual([]);
    expect(chartPoints([samples[0]], 'stone')).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('places points in a plot box with y growing downward', () => {
    const plotted = plotPoints(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      100,
      40,
      4,
    );
    expect(plotted).toEqual([
      { x: 4, y: 36 },
      { x: 96, y: 4 },
    ]);
    expect(pointsAttr(plotted)).toBe('4,36 96,4');
  });

  it('formats the caption from the sample', () => {
    expect(formatChartValue('food', 12.4)).toBe('12');
    expect(formatChartValue('explored', 0.2)).toBe('20%');
    expect(formatChartValue('explored', 1)).toBe('100%');
  });
});

describe('summary text', () => {
  const nameOf = (id: number) => (id === 1 ? 'You' : `Rival ${id - 1}`);

  it('names the local result and the sim reason', () => {
    expect(summaryText({ winners: [1], reason: 'conquest' }, 1, nameOf)).toEqual({
      title: 'Victory',
      winners: 'Winner: You',
      reason: 'conquest',
    });
    expect(summaryText({ winners: [2], reason: 'resign' }, 1, nameOf)).toEqual({
      title: 'Defeat',
      winners: 'Winner: Rival 1',
      reason: 'resign',
    });
    expect(summaryText({ winners: [1, 3], reason: 'resign' }, 1, nameOf).winners).toBe('Winners: You, Rival 2');
    expect(summaryText({ winners: [], reason: 'conquest' }, 1, nameOf).title).toBe('Draw');
    expect(summaryText({ winners: [], reason: 'conquest' }, 1, nameOf).winners).toBe('No winner');
  });
});
