import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../core/types';
import type { World } from '../sim/World';
import { relayOverride } from './lobby';
import type { ClientMessage, ServerMessage } from './protocol';
import { NetworkSession } from './session';

/** Transport fixture: exercise the actual session/replay code without timing a live socket. */
class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = Socket.OPEN;
  sent: ClientMessage[] = [];
  private handlers = new Map<string, ((event: any) => void)[]>();
  constructor(readonly url: string) { Socket.all.push(this); }
  addEventListener(type: string, listener: (event: any) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }
  private emit(type: string, event = {}): void { for (const listener of this.handlers.get(type) ?? []) listener(event); }
  open(): void { this.emit('open'); }
  message(message: ServerMessage): void { this.emit('message', { data: JSON.stringify(message) }); }
  disconnect(code = 1006, reason = ''): void { this.readyState = 3; this.emit('close', { code, reason }); }
  send(text: string): void { this.sent.push(JSON.parse(text)); }
  close(): void { this.disconnect(1000); }
  input(turn: number) { return this.sent.find((m): m is Extract<ClientMessage, { type: 'input' }> => m.type === 'input' && m.turn === turn); }
}

const config = { seed: 1, players: 2 };
const token = 'a'.repeat(48);
const train: Command = { type: 'train', buildingId: 4 };
const sessions: NetworkSession[] = [];
function welcome(socket: Socket): void {
  socket.open();
  socket.message({ type: 'welcome', code: 'ABCDEF', player: 1, token, host: true, config, roster: [] });
}
function fixture() {
  const session = new NetworkSession({ type: 'join', version: 1, code: 'ABCDEF', name: 'Host', token });
  sessions.push(session);
  const socket = Socket.all[0]; welcome(socket);
  const dispatch = vi.fn();
  // These tests start at turn 1 so no hash is due; only command delivery/replay is under test.
  const world = { localPlayer: 1, gameOver: null, dispatch, tick: vi.fn() } as unknown as World;
  session.bindWorld(world, 1);
  world.dispatch(train);
  socket.message({ type: 'turn', turn: 1, commands: [] });
  session.advance();
  expect(socket.input(2)?.commands).toEqual([train]);
  return { session, socket, world, dispatch };
}
function reconnect(socket: Socket): Socket {
  socket.disconnect();
  vi.advanceTimersByTime(1000);
  const next = Socket.all.at(-1)!;
  expect(next).not.toBe(socket);
  welcome(next);
  return next;
}

beforeEach(() => {
  vi.useFakeTimers(); Socket.all = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('location', { href: 'https://agesago.jedm.dev/', protocol: 'https:' });
  vi.stubGlobal('sessionStorage', { setItem: vi.fn() });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('network reconnect delivery', () => {
  it('resends the uncommitted batch and preserves later orders for the following turn', () => {
    const f = fixture();
    f.world.dispatch({ type: 'townBell' });
    const resumed = reconnect(f.socket);
    resumed.message({ type: 'start', config, turn: 2, history: [] });
    expect(resumed.input(2)?.commands).toEqual([train]);
    resumed.message({ type: 'turn', turn: 2, commands: [{ player: 1, command: train }] });
    f.session.advance();
    expect(f.dispatch.mock.calls).toEqual([[train, 1]]);
    expect(resumed.input(3)?.commands).toEqual([{ type: 'townBell' }]);
  });

  it.each([false, true])('replays a committed batch exactly once (commit received before disconnect: %s)', (received) => {
    const f = fixture();
    const frame = { turn: 2, commands: [{ player: 1, command: train }] };
    if (received) f.socket.message({ type: 'turn', ...frame });
    const resumed = reconnect(f.socket);
    resumed.message({ type: 'start', config, turn: 3, history: [frame] });
    f.session.advance();
    expect(f.dispatch.mock.calls).toEqual([[train, 1]]);
    expect(resumed.input(2)).toBeUndefined();
    expect(resumed.input(3)?.commands).toEqual([]);
    resumed.message({ type: 'turn', turn: 3, commands: [] });
    f.session.advance();
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each(['Session resumed elsewhere', 'Invalid message rate'])('stops automatic reconnect after policy close: %s', (reason) => {
    const f = fixture();
    f.socket.disconnect(1008, reason);
    expect(f.session.stopped).toBe(true);
    expect(f.session.status).toMatch(reason === 'Session resumed elsewhere' ? /another tab/ : /session has ended/);
    vi.advanceTimersByTime(3000);
    expect(Socket.all).toHaveLength(1);
  });
});

describe('test relay endpoint boundary', () => {
  it('ignores e2e relay overrides on production pages', () => {
    expect(relayOverride('?e2e&relay=ws://localhost:4191/multiplayer', 'agesago.jedm.dev')).toBeUndefined();
    expect(relayOverride('?e2e&relay=wss://attacker.example/multiplayer', 'agesago.jedm.dev')).toBeUndefined();
  });

  it('allows only loopback pages paired with loopback ws endpoints', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      for (const endpoint of ['ws://localhost:4191/multiplayer', 'ws://127.0.0.1:4191/multiplayer', 'ws://[::1]:4191/multiplayer']) {
        expect(relayOverride(`?relay=${encodeURIComponent(endpoint)}`, host)).toBe(endpoint);
      }
      for (const endpoint of ['ws://attacker.example/multiplayer', 'ws://localhost.attacker.example/multiplayer', 'wss://localhost/multiplayer', 'https://localhost/multiplayer', 'not a URL']) {
        expect(relayOverride(`?relay=${encodeURIComponent(endpoint)}`, host)).toBeUndefined();
      }
    }
  });
});
