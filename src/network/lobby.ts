import { NetworkSession } from './session';
import { NETWORK_VERSION, type ServerMessage } from './protocol';

/** Kept separate from single-player setup so joining never discards its resume. */
export function mountOnline(root: HTMLElement, onStart: (session: NetworkSession, data: Extract<ServerMessage, { type: 'start' }>) => void): () => void {
  const home = root.querySelector<HTMLElement>('#title-home');
  const actions = home?.querySelector('.title-actions');
  if (!home || !actions) return () => {};
  const button = document.createElement('button');
  button.id = 'title-online'; button.type = 'button'; button.className = 'endgame-btn'; button.textContent = 'Online game'; actions.append(button);
  const panel = document.createElement('section');
  panel.id = 'online-lobby'; panel.hidden = true;
  panel.innerHTML = `<p class="loading-kicker">Online game</p><h1>Play with friends</h1>
    <label class="title-field">Your name <input id="online-name" maxlength="32" value="Player" autocomplete="nickname"></label>
    <label class="title-field">Room code <input id="online-code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
    <label class="title-field">Seed <input id="online-seed" type="number" min="1" max="1000000000" value="1"></label>
    <label class="title-field">Players <select id="online-players"><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
    <p class="title-copy">All players join before the host starts. A disconnected player has 30 seconds to rejoin.</p>
    <p id="online-note" class="title-note" role="status"></p><ul id="online-roster"></ul>
    <div class="title-actions"><button id="online-create" class="endgame-btn" type="button">Create room</button><button id="online-join" class="endgame-btn" type="button">Join room</button><button id="online-start" class="endgame-btn" type="button" hidden>Start match</button><button id="online-back" class="endgame-btn" type="button">Back</button></div>`;
  root.querySelector('.title-card')!.append(panel);
  const field = (id: string) => panel.querySelector<HTMLInputElement>(`#${id}`)!;
  const note = panel.querySelector<HTMLElement>('#online-note')!;
  let session: NetworkSession | null = null;
  let unsubscribe = () => {};
  let offStart = () => {};
  let booting = false;
  const close = () => { unsubscribe(); offStart(); session?.dispose(); session = null; };
  const connect = (join: boolean) => {
    close(); booting = false;
    const name = field('online-name').value.trim().slice(0, 32) || 'Player';
    const code = field('online-code').value.trim().toUpperCase();
    const seed = Number(field('online-seed').value);
    if (join && !/^[A-Z0-9]{6}$/.test(code)) { note.textContent = 'Enter the six-character room code.'; return; }
    if (!join && (!Number.isSafeInteger(seed) || seed < 1 || seed > 1e9)) { note.textContent = 'Enter a seed from 1 to 1000000000.'; return; }
    let token: string | undefined;
    try { const saved = JSON.parse(sessionStorage.getItem('agesago-online') ?? 'null'); if (saved?.code === code) token = saved.token; } catch { /* No saved online seat. */ }
    const override = (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) ? new URLSearchParams(location.search).get('relay') ?? undefined : undefined;
    session = new NetworkSession(join
      ? { type: 'join', version: NETWORK_VERSION, code, name, ...(token ? { token } : {}) }
      : { type: 'create', version: NETWORK_VERSION, config: { seed, players: Number(field('online-players').value) }, name }, override);
    const current = session;
    unsubscribe = session.subscribe(() => {
      note.textContent = current.code ? `Room ${current.code} · ${current.status}` : current.status;
      if (current.code) field('online-code').value = current.code;
      const list = panel.querySelector('#online-roster')!; list.replaceChildren();
      for (const peer of current.roster) { const li = document.createElement('li'); li.textContent = `${peer.name}${peer.player === current.player ? ' (you)' : ''} · ${peer.connected ? 'connected' : 'reconnecting'}`; list.append(li); }
      const start = panel.querySelector<HTMLButtonElement>('#online-start')!;
      start.hidden = !current.host || current.started;
      start.disabled = current.roster.length !== current.config?.players || current.roster.some(peer => !peer.connected);
    });
    offStart = session.onStart(data => { if (booting) return; booting = true; panel.hidden = true; onStart(current, data); });
  };
  button.addEventListener('click', () => { home.hidden = true; panel.hidden = false; field('online-name').focus(); });
  panel.querySelector('#online-create')!.addEventListener('click', () => connect(false));
  panel.querySelector('#online-join')!.addEventListener('click', () => connect(true));
  panel.querySelector('#online-start')!.addEventListener('click', () => session?.start());
  panel.querySelector('#online-back')!.addEventListener('click', () => { close(); panel.hidden = true; home.hidden = false; button.focus(); });
  return () => { unsubscribe(); offStart(); button.remove(); panel.remove(); };
}
