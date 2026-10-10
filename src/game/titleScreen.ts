import { CIVS, CIV_IDS, type CivId } from '../core/civilizations';
import { MAP_SIZES, MAP_TYPES, type MapSize, type MapType } from '../core/maps';
import { DEFAULT_SEED } from '../core/types';
import { parseSeed } from './matchSetup';
import { idbResumeStore, readResume } from './resume';
import { AUDIO_CREDIT } from './music';
import { closeSettings, settingsOpen } from './settingsPanel';

export interface TitleHooks {
  onContinue(): void;
  onStart(seed: number, players: number, options: {civ:CivId;mapSize:MapSize;mapType:MapType}): void;
  onTutorial(): void;
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
  const credit = document.createElement('p');
  credit.id = 'title-audio-credit';
  credit.className = 'title-copy';
  credit.textContent = AUDIO_CREDIT;
  const creditActions = credits.querySelector('.title-actions');
  if (creditActions) credits.insertBefore(credit, creditActions);
  else credits.append(credit);

  const select = (id:string,label:string,items:[string,string][],value:string) => {
    const field=document.createElement('label');field.className='title-field';field.htmlFor=id;field.textContent=label;
    const input=document.createElement('select');input.id=id;
    for(const [value,text] of items){const option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}
    input.value=value;field.append(input); setup.querySelector('.title-actions')?.before(field);return input;
  };
  const civSelect=select('title-civ','Civilization',CIV_IDS.map(id=>[id,CIVS[id].name]),'hellenes');
  const sizeSelect=select('title-map-size','Map size',Object.entries(MAP_SIZES).map(([id,size])=>[id,`${id[0].toUpperCase()+id.slice(1)} (${size} × ${size})`]),'large');
  const names={mediterranean:'Mediterranean',highlands:'Highlands',riverValley:'River Valley',forest:'Forest',islands:'Islands'};
  const typeSelect=select('title-map-type','Landscape',MAP_TYPES.map(id=>[id,names[id]]),'mediterranean');
  const bonus=document.createElement('p');bonus.className='title-copy';bonus.id='title-civ-bonus';typeSelect.parentElement!.after(bonus);
  const describeCiv=()=>{bonus.textContent=CIVS[civSelect.value as CivId].description;};civSelect.addEventListener('change',describeCiv);describeCiv();
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
  root.querySelector('#title-tutorial')?.addEventListener('click', () => hooks.onTutorial());
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
    hooks.onStart(seed, players, {civ:civSelect.value as CivId,mapSize:sizeSelect.value as MapSize,mapType:typeSelect.value as MapType});
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.code !== 'Escape') return;
    if (!document.documentElement.classList.contains('show-title')) return;
    if (settingsOpen()) {
      event.preventDefault();
      closeSettings();
      return;
    }
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

  return () => {
    window.removeEventListener('keydown', onKey);
    credit.remove();
    civSelect.parentElement?.remove();sizeSelect.parentElement?.remove();typeSelect.parentElement?.remove();bonus.remove();
  };
}

function section(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function seedFromLocation(): number | null {
  return parseSeed(new URLSearchParams(location.search).get('seed'));
}
