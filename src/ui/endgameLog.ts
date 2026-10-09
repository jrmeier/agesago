/**
 * Match log for the conquest / resign summary.
 * Wonder and relic victories are not in this change: they depend on tickets that are not built.
 * Samples are economy and exploration only; the sim does not emit those other results.
 */

/** Sim seconds between stored samples. The game loop records about this often, plus once at the end. */
export const SAMPLE_EVERY = 10;

/** A few hundred points is enough to draw the match; older points are thinned, not dropped from the start. */
export const MAX_SAMPLES = 300;

export interface EndgameSample {
  /** Simulated seconds since the start. */
  time: number;
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  /** Explored fraction of the map, 0..1. */
  explored: number;
}

export type ChartKey = 'food' | 'wood' | 'gold' | 'stone' | 'population' | 'explored';

/** Normalized sparkline point. x is time across the match; y is the series min..max (0.5 when flat). */
export interface ChartPoint {
  x: number;
  y: number;
}

/** Pixel in a plot box. y grows downward, so a larger sample sits higher on the chart. */
export interface PlotPoint {
  x: number;
  y: number;
}

export interface SummaryText {
  title: 'Victory' | 'Defeat' | 'Draw';
  /** Who won, or "No winner" when the sim ends with nobody left. */
  winners: string;
  reason: 'conquest' | 'resign';
}

/**
 * Records local-player samples when the game loop calls it.
 * At most {@link MAX_SAMPLES} are kept: once full, every other older point is dropped and the latest stays.
 */
export class EndgameLog {
  readonly samples: EndgameSample[] = [];
  private nextAt = 0;

  /** True when `time` is due for the next interval sample (always, before the first one). */
  shouldSample(time: number): boolean {
    return this.samples.length === 0 || time >= this.nextAt;
  }

  /**
   * Store one sample. No-op when `time` is still inside the interval, unless `force`
   * (the game-over reading). A second reading at the same sim time replaces the last one.
   * Returns whether the log changed.
   */
  record(sample: EndgameSample, force = false): boolean {
    if (!force && this.samples.length > 0 && sample.time < this.nextAt) return false;
    const copy = { ...sample };
    const last = this.samples[this.samples.length - 1];
    if (last && last.time === sample.time) this.samples[this.samples.length - 1] = copy;
    else {
      this.samples.push(copy);
      this.thin();
    }
    const scheduled = sample.time + SAMPLE_EVERY;
    if (scheduled > this.nextAt) this.nextAt = scheduled;
    return true;
  }

  /** Drop every other point, always keeping the latest, until the log fits. */
  private thin(): void {
    if (this.samples.length <= MAX_SAMPLES) return;
    const kept: EndgameSample[] = [];
    for (let i = 0; i < this.samples.length - 1; i += 2) kept.push(this.samples[i]);
    kept.push(this.samples[this.samples.length - 1]);
    this.samples.splice(0, this.samples.length, ...kept);
  }
}

/** Sparkline for one series. Samples are in time order. An empty log yields no points. */
export function chartPoints(samples: readonly EndgameSample[], key: ChartKey): ChartPoint[] {
  const n = samples.length;
  if (n === 0) return [];
  const values = samples.map((s) => s[key]);
  let lo = values[0];
  let hi = values[0];
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const t0 = samples[0].time;
  const spanT = samples[n - 1].time - t0;
  const spanV = hi - lo;
  return samples.map((s, i) => ({
    x: spanT === 0 ? (n === 1 ? 0.5 : i / (n - 1)) : (s.time - t0) / spanT,
    y: spanV === 0 ? 0.5 : (values[i] - lo) / spanV,
  }));
}

/** Place normalized points in a `width`×`height` box, inset by `pad`. */
export function plotPoints(points: readonly ChartPoint[], width: number, height: number, pad = 2): PlotPoint[] {
  const w = Math.max(0, width - pad * 2);
  const h = Math.max(0, height - pad * 2);
  return points.map((p) => ({ x: pad + p.x * w, y: pad + (1 - p.y) * h }));
}

/** SVG `points` attribute. Coordinates are rounded to hundredths. */
export function pointsAttr(points: readonly PlotPoint[]): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
}

/** Caption for the last value of a series. Explored is a whole percent; the rest are rounded counts. */
export function formatChartValue(key: ChartKey, value: number): string {
  if (key === 'explored') {
    const pct = Math.floor(Math.min(1, Math.max(0, value)) * 100 + 1e-9);
    return `${pct}%`;
  }
  return String(Math.round(value));
}

/** Headline for the local player. `reason` is the sim value, conquest or resign. */
export function summaryText(
  result: { winners: readonly number[]; reason: 'conquest' | 'resign' },
  localPlayer: number,
  nameOf: (id: number) => string,
): SummaryText {
  const title = result.winners.length === 0 ? 'Draw' : result.winners.includes(localPlayer) ? 'Victory' : 'Defeat';
  const winners =
    result.winners.length === 0
      ? 'No winner'
      : `${result.winners.length === 1 ? 'Winner' : 'Winners'}: ${result.winners.map((id) => nameOf(id)).join(', ')}`;
  return { title, winners, reason: result.reason };
}
