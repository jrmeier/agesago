import { deviceQuality } from '../core/quality';
import { audioBus, bindAudioUnlock } from './audioBus';
import {
  currentSettings,
  graphicsLocked,
  replaceSettings,
  tierToggles,
  type QualityChoice,
  type Settings,
} from './settings';

let openImpl: () => void = () => {};
let closeImpl: () => void = () => {};

export function settingsOpen(): boolean {
  const root = document.getElementById('settings');
  return root != null && !root.hidden;
}

export function openSettings(): void {
  openImpl();
}

export function closeSettings(): void {
  closeImpl();
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

/** Wire the shared settings sheet. Safe to call before a match exists. */
export function mountSettings(): () => void {
  const root = must<HTMLElement>('settings');
  const quality = must<HTMLSelectElement>('settings-quality');
  const shadows = must<HTMLInputElement>('settings-shadows');
  const grass = must<HTMLInputElement>('settings-grass');
  const water = must<HTMLInputElement>('settings-water');
  const ui = must<HTMLInputElement>('settings-ui');
  const edge = must<HTMLInputElement>('settings-edge');
  const edgeSpeed = must<HTMLInputElement>('settings-edge-speed');
  const invert = must<HTMLInputElement>('settings-invert');
  const master = must<HTMLInputElement>('settings-master');
  const music = must<HTMLInputElement>('settings-music');
  const sfx = must<HTMLInputElement>('settings-sfx');
  const colorblind = must<HTMLInputElement>('settings-colorblind');
  const motion = must<HTMLInputElement>('settings-motion');
  const lockNote = document.getElementById('settings-lock-note');
  let filling = false;

  const fill = () => {
    filling = true;
    const s = currentSettings();
    quality.value = s.quality;
    quality.disabled = graphicsLocked();
    shadows.checked = s.shadows;
    grass.checked = s.grass;
    water.checked = s.water;
    ui.value = String(s.uiScale);
    edge.checked = s.edgeScroll;
    edgeSpeed.value = String(s.edgeSpeed);
    edgeSpeed.disabled = !s.edgeScroll;
    invert.checked = s.invertPan;
    master.value = String(s.master);
    music.value = String(s.music);
    sfx.value = String(s.sfx);
    colorblind.checked = s.colorblind;
    motion.checked = s.reducedMotion;
    if (lockNote) {
      lockNote.hidden = !graphicsLocked();
      lockNote.textContent = graphicsLocked()
        ? 'This page’s ?quality= chooses the graphics for this visit. Other settings still save.'
        : '';
    }
    filling = false;
  };

  const commit = () => {
    if (filling) return;
    const prev = currentSettings();
    let next: Settings = {
      quality: quality.value as QualityChoice,
      shadows: shadows.checked,
      grass: grass.checked,
      water: water.checked,
      uiScale: Number(ui.value),
      edgeScroll: edge.checked,
      edgeSpeed: Number(edgeSpeed.value),
      invertPan: invert.checked,
      master: Number(master.value),
      music: Number(music.value),
      sfx: Number(sfx.value),
      colorblind: colorblind.checked,
      reducedMotion: motion.checked,
    };
    if (next.quality !== prev.quality) {
      const toggles = tierToggles(next.quality, deviceQuality());
      next = { ...next, ...toggles };
      filling = true;
      shadows.checked = toggles.shadows;
      grass.checked = toggles.grass;
      water.checked = toggles.water;
      filling = false;
    }
    const volumeChanged = next.sfx !== prev.sfx || next.master !== prev.master || next.music !== prev.music;
    replaceSettings(next);
    edgeSpeed.disabled = !next.edgeScroll;
    if (volumeChanged) audioBus.chime();
  };

  const open = () => {
    fill();
    root.hidden = false;
    must<HTMLElement>('settings-close').focus();
  };
  const close = () => {
    root.hidden = true;
  };
  openImpl = open;
  closeImpl = close;

  const onChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'range') return;
    commit();
  };
  const onInput = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'range') commit();
  };
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  document.getElementById('settings-close')?.addEventListener('click', close);
  document.getElementById('title-settings')?.addEventListener('click', open);
  document.getElementById('pause-settings')?.addEventListener('click', open);
  const unlock = bindAudioUnlock(audioBus, window);

  return () => {
    root.removeEventListener('change', onChange);
    root.removeEventListener('input', onInput);
    unlock();
    openImpl = () => {};
    closeImpl = () => {};
  };
}
