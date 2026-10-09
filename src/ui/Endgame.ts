import type { SimEvent } from '../core/types';
import type { World } from '../sim/World';
import {
  chartPoints,
  formatChartValue,
  plotPoints,
  pointsAttr,
  summaryText,
  type ChartKey,
  type EndgameLog,
  type EndgameSample,
} from './endgameLog';

/** Plot box matching the `.endgame-plot` viewBox in index.html. */
const PLOT_W = 200;
const PLOT_H = 64;
const PLOT_PAD = 3;

const SERIES: readonly { key: ChartKey; stroke: string }[] = [
  { key: 'food', stroke: '#a86b18' },
  { key: 'wood', stroke: '#6b3e16' },
  { key: 'gold', stroke: '#a8740f' },
  { key: 'stone', stroke: '#6e6248' },
  { key: 'population', stroke: '#8d2c22' },
  { key: 'explored', stroke: '#2a6a4a' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Resign control and the end-of-match sheet.
 * Wonder and relic victories are not shown: those tickets are not built. Only conquest and resign.
 */
export class Endgame {
  private done = false;
  private readonly stop = new AbortController();
  private readonly unlisten: () => void;
  private readonly root: HTMLElement | null;
  private readonly resignBtn: HTMLButtonElement | null;

  constructor(
    private readonly world: World,
    private readonly log: EndgameLog,
    private readonly onDecided: () => void,
  ) {
    this.root = document.getElementById('endgame');
    this.resignBtn = document.getElementById('resign-btn') as HTMLButtonElement | null;
    const again = document.getElementById('play-again');
    const signal = this.stop.signal;
    this.resignBtn?.addEventListener('click', () => this.world.dispatch({ type: 'resign' }), { signal });
    again?.addEventListener('click', () => location.reload(), { signal });
    this.unlisten = this.world.events.on('gameOver', (e) => this.finish(e));
  }

  /** One interval sample. The game loop calls this about every 10 sim seconds. */
  sample(): void {
    if (this.done) return;
    this.log.record(this.reading());
  }

  dispose(): void {
    this.unlisten();
    this.stop.abort();
  }

  private reading(): EndgameSample {
    const stock = this.world.stock;
    return {
      time: this.world.time,
      food: stock.food,
      wood: stock.wood,
      gold: stock.gold,
      stone: stock.stone,
      population: this.world.pop,
      explored: this.world.visibility.exploredFraction,
    };
  }

  /** gameOver for this client: local player won or lost. Records the terminal sample once. */
  private finish(e: Extract<SimEvent, { type: 'gameOver' }>): void {
    if (this.done) return;
    this.done = true;
    this.log.record(this.reading(), true);
    this.onDecided();
    this.show(e.winners, e.reason);
  }

  private show(winners: readonly number[], reason: 'conquest' | 'resign'): void {
    const root = this.root;
    if (!root) return;
    const text = summaryText({ winners, reason }, this.world.localPlayer, (id) => this.nameOf(id));
    const title = document.getElementById('endgame-title');
    const winnerLine = document.getElementById('endgame-winners');
    const reasonLine = document.getElementById('endgame-reason');
    if (title) title.textContent = text.title;
    if (winnerLine) winnerLine.textContent = text.winners;
    if (reasonLine) reasonLine.textContent = `Reason: ${text.reason}`;
    this.drawCharts();
    if (this.resignBtn) this.resignBtn.hidden = true;
    root.hidden = false;
    document.getElementById('play-again')?.focus();
  }

  private nameOf(id: number): string {
    return this.world.players.get(id)?.player.name ?? `Player ${id}`;
  }

  private drawCharts(): void {
    const root = this.root;
    if (!root) return;
    const samples = this.log.samples;
    const last = samples[samples.length - 1];
    for (const series of SERIES) {
      const fig = root.querySelector<HTMLElement>(`[data-series="${series.key}"]`);
      if (!fig) continue;
      const caption = fig.querySelector('figcaption b');
      const label = fig.querySelector('figcaption span')?.textContent ?? series.key;
      const value = last ? formatChartValue(series.key, last[series.key]) : '—';
      if (caption) caption.textContent = value;
      const svg = fig.querySelector('svg.endgame-plot');
      if (!svg) continue;
      svg.setAttribute('aria-label', last ? `${label} ${value}` : label);
      svg.replaceChildren();
      const pts = plotPoints(chartPoints(samples, series.key), PLOT_W, PLOT_H, PLOT_PAD);
      if (pts.length === 0) continue;
      const floor = PLOT_H - PLOT_PAD;
      const base = document.createElementNS(SVG_NS, 'line');
      base.setAttribute('x1', String(PLOT_PAD));
      base.setAttribute('x2', String(PLOT_W - PLOT_PAD));
      base.setAttribute('y1', String(floor));
      base.setAttribute('y2', String(floor));
      base.setAttribute('stroke', '#8a6230');
      base.setAttribute('stroke-width', '1');
      base.setAttribute('opacity', '0.45');
      base.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(base);
      if (pts.length >= 2) {
        const area = document.createElementNS(SVG_NS, 'polygon');
        area.setAttribute('points', `${pointsAttr(pts)} ${pts[pts.length - 1].x},${floor} ${pts[0].x},${floor}`);
        area.setAttribute('fill', series.stroke);
        area.setAttribute('opacity', '0.18');
        svg.append(area);
        const line = document.createElementNS(SVG_NS, 'polyline');
        line.setAttribute('points', pointsAttr(pts));
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', series.stroke);
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-linejoin', 'round');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(line);
      } else {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', String(pts[0].x));
        dot.setAttribute('cy', String(pts[0].y));
        dot.setAttribute('r', '2.5');
        dot.setAttribute('fill', series.stroke);
        svg.append(dot);
      }
    }
  }
}
