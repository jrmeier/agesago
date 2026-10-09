import { Game } from './game/Game';

const container = document.getElementById('game-container');
if (!container) throw new Error('#game-container not found');

const game = new Game(container);

// Dev builds, and production builds opened with ?e2e (browser smoke tests), expose the game for inspection.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
  (window as unknown as { game: Game }).game = game;
}
if (import.meta.env.DEV) import.meta.hot?.dispose(() => game.dispose());
