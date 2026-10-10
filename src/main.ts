import { devHook } from './game/devHook';
import { Game, type MatchStart } from './game/Game';
import { deleteResume, idbResumeStore } from './game/resume';
import { initSettings } from './game/settings';
import { mountSettings } from './game/settingsPanel';
import { mountTitle } from './game/titleScreen';

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

function reveal(game: Game): void {
  running = game;
  // Seed and town count for a match opened from the title screen, which has no dev hook.
  document.documentElement.dataset.seed = String(game.world.seed ?? '');
  document.documentElement.dataset.players = String(game.world.players.size);
  if (loading) {
    loading.classList.add('is-done');
    loading.addEventListener('transitionend', () => loading.remove(), { once: true });
    window.setTimeout(() => loading.remove(), 700);
  }
  // Dev builds, and production builds opened with ?e2e (browser smoke tests), expose the game for inspection.
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
    (window as unknown as { game: Game }).game = game;
    // Dev-only cheats for e2e tests (resources, finished buildings, fast-forward, statOf).
    (window as unknown as { dev: ReturnType<typeof devHook> }).dev = devHook(game.world);
  }
  if (import.meta.env.DEV) console.info('[agesago] boot ms', game.boot);
}

async function bootMatch(start: MatchStart): Promise<void> {
  document.documentElement.classList.remove('show-title');
  const game = await Game.start(container, reportBoot, start);
  reveal(game);
}

initSettings();
const closeSettingsPanel = mountSettings();

const title = document.getElementById('title-screen');
if (new URLSearchParams(location.search).has('e2e') || !title) {
  await bootMatch({});
} else {
  let closeTitle = () => {};
  closeTitle = mountTitle(title, {
    onContinue() {
      closeTitle();
      void bootMatch({});
    },
    onStart(seed, players) {
      closeTitle();
      const url = new URL(location.href);
      url.search = `seed=${seed}`;
      history.replaceState(null, '', url);
      document.documentElement.classList.remove('show-title');
      void deleteResume(idbResumeStore())
        .catch(() => undefined)
        .then(() => bootMatch({ seed, players, fresh: true }));
    },
  });
}

if (import.meta.env.DEV) {
  import.meta.hot?.dispose(() => {
    closeSettingsPanel();
    running?.dispose();
  });
}
