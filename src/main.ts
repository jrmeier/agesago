import { GameWorld } from './world/GameWorld';

const container = document.getElementById('game-container');
if (!container) throw new Error('#game-container not found');

const game = new GameWorld(container);
(window as any).game = game;
