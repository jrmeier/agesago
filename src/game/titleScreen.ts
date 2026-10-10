import { DEFAULT_SEED } from '../core/types';
import { parseSeed } from './matchSetup';
import { idbResumeStore, readResume } from './resume';

export interface TitleHooks {
  onContinue(): void;
  onStart(seed: number, players: number): void;
}

/** Wire the title screen. Returns a disposer that drops the Escape listener. */
export function mountTitle(root: HTMLElement, hooks: TitleHooks): () => void {
  const home = section(root, 'title-home');
  const setup = section(root, 'title-setup');
  const credits = section(root, 'title-credits-panel');
  const discard = section(root, 'title-discard');
  const seedInput = root.querySelector<HTMLInputElement>('#title-seed');
  const seedNote = root.querySelector<HTMLElement>('#title-seed-note');
  const continueBtn = root.querySelector<HTMLButtonElement>('#title-continue');
  if (!seedInput || !continueBtn) throw new Error('title screen is missing its fields');

  const shared = seedFromLocation();
  seedInput.value = String(shared ?? DEFAULT_SEED);
  let players = 2;
  let hasResume = false;

  const show = (name: 'home' | 'setup' | 'credits' | 'discard') => {
    home.hidden = name !== 'home';
    setup.hidden = name !== 'setup';
    credits.hidden = name !== 'credits';
    discard.hidden = name !== 'discard';
    const focusId = name === 'setup' ? 'title-seed' : name === 'credits' ? 'title-credits-back' : name === 'discard' ? 'title-discard-no' : 'title-new';
    root.querySelector<HTMLElement>(`#${focusId}`)?.focus();
  };

  const selectPlayers = (n: number) => {
    players = n;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-players]')) {
      btn.setAttribute('aria-pressed', btn.dataset.players === String(n) ? 'true' : 'false');
    }
  };
  selectPlayers(2);

  root.querySelector('#title-new')?.addEventListener('click', () => {
    if (seedNote) seedNote.hidden = true;
    show(hasResume ? 'discard' : 'setup');
  });
  root.querySelector('#title-discard-yes')?.addEventListener('click', () => show('setup'));
  root.querySelector('#title-discard-no')?.addEventListener('click', () => show('home'));
  root.querySelector('#title-setup-back')?.addEventListener('click', () => show('home'));
  root.querySelector('#title-credits')?.addEventListener('click', () => show('credits'));
  root.querySelector('#title-credits-back')?.addEventListener('click', () => show('home'));
  continueBtn.addEventListener('click', () => {
    if (!continueBtn.disabled) hooks.onContinue();
  });
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-players]')) {
    btn.addEventListener('click', () => selectPlayers(Number(btn.dataset.players)));
  }
  root.querySelector('#title-random')?.addEventListener('click', () => {
    seedInput.value = String(1 + Math.floor(Math.random() * 999_999_999));
    if (seedNote) seedNote.hidden = true;
  });
  root.querySelector('#title-start')?.addEventListener('click', () => {
    const seed = parseSeed(seedInput.value);
    if (seed == null) {
      if (seedNote) {
        seedNote.hidden = false;
        seedNote.textContent = 'Enter a seed from 1 to 1000000000.';
      }
      seedInput.focus();
      return;
    }
    hooks.onStart(seed, players);
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.code !== 'Escape') return;
    if (!document.documentElement.classList.contains('show-title')) return;
    if (!discard.hidden || !setup.hidden || !credits.hidden) {
      event.preventDefault();
      show('home');
    }
  };
  window.addEventListener('keydown', onKey);

  void readResume(idbResumeStore()).then((loaded) => {
    hasResume = loaded.envelope != null;
    continueBtn.disabled = !hasResume;
    root.dataset.resume = loaded.failed ? 'broken' : hasResume ? 'yes' : 'no';
    const hint = root.querySelector<HTMLElement>('#title-continue-hint');
    if (hint) hint.hidden = !loaded.failed;
  });

  return () => window.removeEventListener('keydown', onKey);
}

function section(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function seedFromLocation(): number | null {
  return parseSeed(new URLSearchParams(location.search).get('seed'));
}
