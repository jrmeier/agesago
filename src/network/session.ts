import type { Command } from '../core/types';
import type { World } from '../sim/World';
import { applyTurn, stateHash } from './lockstep';
import { HASH_EVERY, MAX_COMMANDS, NETWORK_VERSION, type ClientMessage, type MatchConfig, type RosterEntry, type ServerMessage, type Turn } from './protocol';

export class NetworkSession {
  code = '';
  player = 0;
  host = false;
  config: MatchConfig | null = null;
  roster: RosterEntry[] = [];
  status = 'Connecting…';
  stopped = false;
  started = false;
  turn = 0;
  readonly checks: { turn: number; hash: string }[] = [];
  private token = '';
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private starts = new Set<(data: Extract<ServerMessage, { type: 'start' }>) => void>();
  private frames: Turn[] = [];
  private pending: Command[] = [];
  private world: World | null = null;
  private applying = false;
  private originalDispatch: World['dispatch'] | null = null;
  private reconnectTimer = 0;
  private closed = false;
  private sentTurn = -1;
  private readonly url: string;
  private readonly request: Extract<ClientMessage, { type: 'create' | 'join' }>;

  constructor(request: Extract<ClientMessage, { type: 'create' | 'join' }>, url?: string) {
    this.request = request;
    const endpoint = new URL('/multiplayer', location.href);
    endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = url ?? endpoint.href;
    this.connect();
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); listener(); return () => this.listeners.delete(listener); }
  onStart(listener: (data: Extract<ServerMessage, { type: 'start' }>) => void): () => void { this.starts.add(listener); return () => this.starts.delete(listener); }
  private changed(): void { for (const listener of this.listeners) listener(); }
  private send(message: ClientMessage): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  start(): void { this.send({ type: 'start' }); }

  private connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.send(this.token ? { type: 'join', version: NETWORK_VERSION, code: this.code, token: this.token, name: this.request.name } : this.request);
    });
    socket.addEventListener('message', event => {
      let message: ServerMessage;
      try { message = JSON.parse(String(event.data)) as ServerMessage; } catch { return; }
      switch (message.type) {
        case 'welcome':
          this.code = message.code; this.player = message.player; this.token = message.token; this.host = message.host;
          this.config = message.config; this.roster = message.roster; this.stopped = false; this.sentTurn = -1;
          this.status = this.started ? 'Reconnected. Catching up…' : 'Share the room code with your friends.';
          try { sessionStorage.setItem('agesago-online', JSON.stringify({ code: this.code, token: this.token, name: this.request.name })); } catch { /* Storage may be unavailable. */ }
          break;
        case 'roster': this.roster = message.roster; break;
        case 'start':
          this.config = message.config; this.started = true;
          if (this.world) {
            const history = new Map(message.history.map(frame => [frame.turn, frame.commands]));
            this.frames = [];
            for (let turn = this.turn; turn < message.turn; turn++) this.frames.push({ turn, commands: history.get(turn) ?? [] });
            if (!this.frames.length) this.submit();
          } else for (const start of this.starts) start(message);
          break;
        case 'turn': if (message.turn >= this.turn && !this.frames.some(f => f.turn === message.turn)) this.frames.push(message); break;
        case 'waiting': this.status = message.text; break;
        case 'desync': this.stopped = true; this.status = `The match paused because the browsers disagreed at turn ${message.turn}. Start a new room after both refresh.`; break;
        case 'error': this.status = message.text; break;
      }
      this.changed();
    });
    socket.addEventListener('error', () => { this.status = 'Could not connect to online play.'; this.changed(); });
    socket.addEventListener('close', () => {
      if (this.closed) return;
      this.sentTurn = -1; this.stopped = true;
      this.status = this.token ? 'Disconnected. Reconnecting…' : 'Online play is unavailable. Try again shortly.';
      this.changed();
      if (this.token) this.reconnectTimer = window.setTimeout(() => this.connect(), 1000);
    });
  }

  /** Called after replay, before the first live frame. Commands only run when relayed. */
  bindWorld(world: World, turn: number): void {
    this.world = world; this.turn = turn;
    this.originalDispatch = world.dispatch;
    world.dispatch = (command: Command, by = world.localPlayer) => {
      if (this.applying) { this.originalDispatch!.call(world, command, by); return; }
      if (by !== this.player || this.stopped || world.gameOver) return;
      if (this.pending.length >= MAX_COMMANDS) { this.status = 'Too many orders at once. Wait a moment.'; this.changed(); return; }
      this.pending.push(structuredClone(command));
    };
    this.status = 'Connected'; this.changed(); this.submit();
  }

  advance(): number {
    if (!this.world || this.stopped) return 0;
    let advanced = 0;
    for (let i = 0; i < 5 && this.frames.length; i++) {
      const frame = this.frames[0];
      if (frame.turn !== this.turn) break;
      this.frames.shift(); this.applying = true;
      try { applyTurn(this.world, frame); } finally { this.applying = false; }
      this.turn++; advanced++;
    }
    if (!this.frames.length) this.submit();
    if (advanced) { this.status = 'Connected'; this.changed(); }
    return advanced;
  }

  private submit(): void {
    if (!this.world || this.stopped || this.sentTurn === this.turn || this.world.gameOver || this.socket?.readyState !== WebSocket.OPEN) return;
    const hash = this.turn % HASH_EVERY === 0 ? stateHash(this.world) : undefined;
    if (hash) { this.checks.push({ turn: this.turn, hash }); if (this.checks.length > 20) this.checks.shift(); }
    this.send({ type: 'input', turn: this.turn, commands: this.pending.splice(0), ...(hash ? { hash } : {}) });
    this.sentTurn = this.turn;
  }

  dispose(): void {
    this.closed = true; window.clearTimeout(this.reconnectTimer); this.socket?.close();
    if (this.world && this.originalDispatch) this.world.dispatch = this.originalDispatch;
    this.listeners.clear(); this.starts.clear();
  }
}
