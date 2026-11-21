import type { mountOnline, OnlineLobby } from '../network/lobby';

/** Keep the initial menu usable while the lobby and its sim dependencies load. */
export function mountOnlineEntry(root: HTMLElement, onStart: Parameters<typeof mountOnline>[1]): () => void {
  const button = root.querySelector<HTMLButtonElement>('#title-online');
  const note = root.querySelector<HTMLElement>('#title-online-note');
  if (!button || !note) throw new Error('title screen is missing its online controls');

  let pending: Promise<typeof import('../network/lobby') | null> | null = null;
  let lobby: OnlineLobby | null = null;
  let prefetchFailed = false;
  let busy = false;
  let disposed = false;
  const load = () => pending ??= import('../network/lobby').catch(() => {
    pending = null;
    return null;
  });
  const showError = () => {
    note.textContent = 'Online play could not load. Check your connection and try again.';
    note.hidden = false;
  };
  const prefetch = async () => {
    if (disposed) return;
    const loaded = await load();
    // A background failure is explained on the first click; the next click retries.
    if (!loaded && !busy && !disposed) prefetchFailed = true;
  };
  const idleSupported = typeof window.requestIdleCallback === 'function';
  const idle = idleSupported
    ? window.requestIdleCallback(() => { void prefetch(); }, { timeout: 1500 })
    : window.setTimeout(() => { void prefetch(); }, 200);
  const cancelPrefetch = () => {
    if (idleSupported) window.cancelIdleCallback(idle);
    else window.clearTimeout(idle);
  };

  const open = async () => {
    if (disposed || busy) return;
    cancelPrefetch();
    if (prefetchFailed) {
      prefetchFailed = false;
      showError();
      return;
    }
    if (lobby) { lobby.open(); return; }
    busy = true;
    note.textContent = '';
    note.hidden = true;
    // Keep the button's footprint while its shorter loading label is displayed.
    button.style.minWidth = `${button.getBoundingClientRect().width}px`;
    button.textContent = 'Loading…';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const loaded = await load();
      if (disposed) return;
      if (!loaded) { showError(); return; }
      lobby = loaded.mountOnline(root, onStart);
      lobby.open();
    } catch {
      if (!disposed) showError();
    } finally {
      busy = false;
      button.textContent = 'Online game';
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.style.minWidth = '';
    }
  };
  const onClick = () => { void open(); };
  button.addEventListener('click', onClick);
  return () => {
    disposed = true;
    cancelPrefetch();
    button.removeEventListener('click', onClick);
    lobby?.dispose();
  };
}
