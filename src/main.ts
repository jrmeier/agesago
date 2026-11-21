import type { Game, MatchStart } from './game/Game';
import { deleteResume, idbResumeStore } from './game/resume';
import { initSettings } from './game/settings';
import { mountSettings } from './game/settingsPanel';
import { mountOnlineEntry } from './game/onlineEntry';
import { mountTitle } from './game/titleScreen';

// Start fetching the match while the title screen becomes interactive.
const gameModule = import('./game/Game');

const containerEl = document.getElementById('game-container');
if (!containerEl) throw new Error('#game-container not found');
const container: HTMLElement = containerEl;

const loading = document.getElementById('loading');
const loadingStage = document.getElementById('loading-stage');
const loadingBar = document.getElementById('loading-bar');

function reportBoot(label: string, fraction: number): void {
  if (loadingStage) loadingStage.textContent = label;
  if (loadingBar) loadingBar.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`;
}

let running: Game | null = null;

async function reveal(startGame: () => Promise<Game>, start: MatchStart): Promise<void> {
  // Load inspection helpers before starting: Game.start can publish online-ready UI,
  // and callers of that UI expect window.game and window.dev in the same turn.
  const inspection = import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')
    ? await import('./game/devHook')
    : null;
  const game = await startGame();
  running = game;
  // Seed and town count for a match opened from the title screen, which has no dev hook.
  document.documentElement.dataset.seed = String(game.world.seed ?? '');
  document.documentElement.dataset.players = String(game.world.players.size);
  document.documentElement.dataset.mapSize = game.world.mapOptions.size ?? 'large';
  document.documentElement.dataset.mapType = game.world.mapOptions.type ?? 'mediterranean';
  document.documentElement.dataset.wonder = game.world.wonderRules.enabled ? String(game.world.wonderRules.seconds) : 'off';
  document.documentElement.dataset.civ = game.world.players.get(game.world.localPlayer)?.player.civ ?? '';
  const roster = [...game.world.players.values()].map(({ player }) => player);
  document.documentElement.dataset.difficulty = roster.find(p => p.control === 'ai')?.difficulty ?? 'moderate';
  document.documentElement.dataset.teams = roster.length === 4 && roster.map(p => p.team).join(',') === '1,1,2,2'
    ? 'pairs' : roster.length >= 3 && roster.slice(1).every(p => p.team === 2) ? 'allied-rivals' : 'ffa';
  document.documentElement.dataset.resources = start.online || start.tutorial ? 'standard' : start.startingResources ?? 'standard';
  if (loading) {
    loading.classList.add('is-done');
    loading.addEventListener('transitionend', () => loading.remove(), { once: true });
    window.setTimeout(() => loading.remove(), 700);
  }
  // Dev builds, and production builds opened with ?e2e (browser smoke tests), expose the game for inspection.
  if (inspection) {
    const { devHook } = inspection;
    (window as unknown as { game: Game }).game = game;
    // Dev-only cheats for e2e tests (resources, finished buildings, fast-forward, statOf).
    (window as unknown as { dev: ReturnType<typeof devHook> }).dev = devHook(game.world);
  }
  if (import.meta.env.DEV) console.info('[agesago] boot ms', game.boot);
}

async function bootMatch(start: MatchStart): Promise<void> {
  document.documentElement.classList.remove('show-title');
  const { Game } = await gameModule;
  await reveal(() => Game.start(container, reportBoot, start), start);
}

initSettings();
const closeSettingsPanel = mountSettings();

const params = new URLSearchParams(location.search);
const title = document.getElementById('title-screen');
if ((params.has('e2e') && !params.has('title')) || !title) {
  await bootMatch(params.has('tutorial') ? { tutorial: true, players: 2, fresh: true } : {});
} else {
  let closeTitle = () => {};
  let closeOnline = () => {};
  const leaveTitle = () => { closeOnline(); closeTitle(); };
  closeTitle = mountTitle(title, {
    onContinue() {
      leaveTitle();
      void bootMatch({});
    },
    onTutorial() {
      leaveTitle();
      document.documentElement.classList.remove('show-title');
      void bootMatch({ tutorial: true, players: 2, fresh: true });
    },
    onStart(seed, players, options) {
      leaveTitle();
      const url = new URL(location.href);
      url.searchParams.set('seed', String(seed));
      history.replaceState(null, '', url);
      document.documentElement.classList.remove('show-title');
      void deleteResume(idbResumeStore())
        .catch(() => undefined)
        .then(() => bootMatch({ seed, players, ...options, fresh: true }));
    },
  });
  closeOnline = mountOnlineEntry(title, (session, data) => {
    leaveTitle();
    void bootMatch({ seed: data.config.seed, players: data.config.players, fresh: true, online: { session, data } });
  });
}

if (import.meta.env.DEV) {
  import.meta.hot?.dispose(() => {
    closeSettingsPanel();
    running?.dispose();
  });
}
