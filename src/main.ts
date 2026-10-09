import { Game } from './game/Game';

const container = document.getElementById('game-container');
if (!container) throw new Error('#game-container not found');

const loading = document.getElementById('loading');
const loadingStage = document.getElementById('loading-stage');
const loadingBar = document.getElementById('loading-bar');

function reportBoot(label: string, fraction: number): void {
  if (loadingStage) loadingStage.textContent = label;
  if (loadingBar) loadingBar.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`;
}

const game = await Game.start(container, reportBoot);

if (loading) {
  loading.classList.add('is-done');
  loading.addEventListener('transitionend', () => loading.remove(), { once: true });
  window.setTimeout(() => loading.remove(), 700);
}

// Dev builds, and production builds opened with ?e2e (browser smoke tests), expose the game for inspection.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
  (window as unknown as { game: Game }).game = game;
}
if (import.meta.env.DEV) {
  console.info('[agesago] boot ms', game.boot);
  import.meta.hot?.dispose(() => game.dispose());
}
