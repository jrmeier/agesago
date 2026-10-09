import { Game } from './game/Game';

const container = document.getElementById('game-container');
if (!container) throw new Error('#game-container not found');

const game = new Game(container);

if (import.meta.env.DEV) {
  (window as unknown as { game: Game }).game = game;
  import.meta.hot?.dispose(() => game.dispose());
}
