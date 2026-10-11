import type { Game } from './Game';

/** Opt-in diagnostics; reads the real frame interval and renderer counters. */
export class PerfOverlay {
  private element: HTMLElement | null = null;
  private frames: number[] = [];
  private last = 0;
  private nextPaint = 0;
  constructor(container: HTMLElement, search = location.search) {
    if (new URLSearchParams(search).get('debug') !== '1') return;
    const details = document.createElement('details');
    details.id = 'perf-overlay'; details.open = true;
    details.style.cssText = 'position:fixed;right:max(8px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top));z-index:90;background:#181a16eb;color:#eee7d2;padding:8px;font:12px/1.5 monospace;max-width:calc(100vw - 16px);border-radius:4px';
    const summary = document.createElement('summary'); summary.textContent = 'Performance';
    const output = document.createElement('pre'); output.style.margin = '6px 0 0';
    details.append(summary, output); container.append(details); this.element = details;
  }
  update(now: number, game: Game): void {
    if (!this.element) return;
    if (this.last && now - this.last < 1000) { this.frames.push(now - this.last); if (this.frames.length > 120) this.frames.shift(); }
    this.last = now;
    if (now < this.nextPaint || !this.frames.length) return;
    this.nextPaint = now + 500;
    const mean = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const info = game.renderer.webgl.info;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.element.querySelector('pre')!.textContent = `${(1000 / mean).toFixed(1)} FPS · ${mean.toFixed(1)} ms/frame\nP95 ${sorted[Math.floor(sorted.length * .95)].toFixed(1)} ms\n${game.quality.tier} · DPR ${game.renderer.webgl.getPixelRatio().toFixed(2)}\n${info.render.triangles.toLocaleString()} triangles · ${info.render.calls} draws\n${info.memory.geometries} geometries · ${info.memory.textures} textures\n${memory ? `${(memory.usedJSHeapSize / 1048576).toFixed(1)} MB JS heap` : 'JS heap unavailable in this browser'}\n${game.world.units.size} units · ${game.world.buildings.size} buildings\nBoot ${game.boot.totalMs.toFixed(0)} ms · sim ${game.world.time.toFixed(1)} s`;
  }
  dispose(): void { this.element?.remove(); }
}
