import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { createRelayServer } from './relay';
import { NETWORK_VERSION, type ServerMessage, validClientMessage } from './protocol';
import { applyTurn, replay, stateHash } from './lockstep';
import { generateMap } from '../sim/mapgen';
import { World } from '../sim/World';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(reconnectMs = 100) {
  const relay = createRelayServer({ turnMs: 10, reconnectMs, origins: ['http://localhost:4174'] });
  await new Promise<void>(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => relay.close());
  const address = relay.server.address() as AddressInfo;
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/multiplayer`, { origin: 'http://localhost:4174' });
    const messages: ServerMessage[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return { socket, messages, send: (message: unknown) => socket.send(JSON.stringify(message)) };
  };
  const wait = async (peer: Awaited<ReturnType<typeof connect>>, type: ServerMessage['type']) => {
    for (let n = 0; n < 100; n++) { const index = peer.messages.findIndex(m => m.type === type); if (index >= 0) return peer.messages.splice(index, 1)[0]; await new Promise(r => setTimeout(r, 10)); }
    throw new Error(`No ${type}: ${JSON.stringify(peer.messages)}`);
  };
  const host = await connect();
  host.send({ type: 'create', version: NETWORK_VERSION, config: { seed: 1, players: 2 }, name: 'Host' });
  const welcome = await wait(host, 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
  const guest = await connect();
  guest.send({ type: 'join', version: NETWORK_VERSION, code: welcome.code, name: 'Guest' });
  const guestWelcome = await wait(guest, 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
  host.send({ type: 'start' });
  await wait(host, 'start'); await wait(guest, 'start');
  return { relay, connect, wait, host, guest, welcome, guestWelcome };
}

describe('online command relay', () => {
  it('assigns issuer identities, orders both players and waits for each input', async () => {
    const f = await fixture();
    f.host.send({ type: 'input', turn: 0, commands: [{ type: 'townBell', player: 2 }], hash: '12345678' });
    await new Promise(r => setTimeout(r, 30));
    expect(f.host.messages.some(m => m.type === 'turn')).toBe(false);
    f.guest.send({ type: 'input', turn: 0, commands: [{ type: 'resign' }], hash: '12345678' });
    const a = await f.wait(f.host, 'turn') as Extract<ServerMessage, { type: 'turn' }>;
    const b = await f.wait(f.guest, 'turn');
    expect(a).toEqual(b); expect(a.commands.map(c => c.player)).toEqual([1, 2]);
  });
  it('halts before applying a turn when client state hashes disagree', async () => {
    const f = await fixture();
    f.host.send({ type: 'input', turn: 0, commands: [], hash: '00000001' });
    f.guest.send({ type: 'input', turn: 0, commands: [], hash: '00000002' });
    expect((await f.wait(f.host, 'desync')).type).toBe('desync');
    expect(f.host.messages.some(m => m.type === 'turn')).toBe(false);
  });
  it('reserves reconnect seats and then resigns an expired dropped player', async () => {
    const f = await fixture(150);
    f.guest.socket.close(); await new Promise(r => setTimeout(r, 20));
    const returned = await f.connect();
    returned.send({ type: 'join', version: NETWORK_VERSION, code: f.welcome.code, token: f.guestWelcome.token, name: 'Guest' });
    const resumed = await f.wait(returned, 'welcome') as Extract<ServerMessage, { type: 'welcome' }>;
    expect(resumed.player).toBe(2); await f.wait(returned, 'start');
    returned.socket.close(); await new Promise(r => setTimeout(r, 180));
    f.host.send({ type: 'input', turn: 0, commands: [], hash: '00000001' });
    const turn = await f.wait(f.host, 'turn') as Extract<ServerMessage, { type: 'turn' }>;
    expect(turn.commands).toContainEqual({ player: 2, command: { type: 'resign' } });
  });
  it('rejects unknown kinds, malformed positions, oversized batches and missing check hashes', () => {
    const input = (commands: unknown[]) => ({ type: 'input', turn: 0, commands });
    expect(validClientMessage(input([{ type: 'build', unitIds: [1], kind: '__proto__', pos: { x: 1, z: 1 }, rot: 0 }]))).toBe(false);
    expect(validClientMessage(input([{ type: 'move', unitIds: [1], target: { x: Infinity, z: 1 } }]))).toBe(false);
    expect(validClientMessage(input(Array.from({ length: 65 }, () => ({ type: 'resign' }))))).toBe(false);
    expect(validClientMessage(input([{ type: 'research', buildingId: 1, tech: '__proto__' }]))).toBe(false);
  });
});

describe('deterministic command turns', () => {
  it('different local players and UI preferences produce identical hashes through commands and replay', async () => {
    const generated = generateMap(1, 2);
    const make = () => { const world = new World(generated.hf, generated.layout); world.seed = 1; for (const state of world.players.values()) state.player.control = 'human'; return world; };
    const a = make(), b = make(); b.localPlayer = 2; b.players.get(1)!.player.color = 0xff00ff;
    const id = [...a.units.values()].find(u => u.owner === 1 && u.kind === 'villager')!.id;
    const history = [{ turn: 0, commands: [{ player: 1, command: { type: 'move' as const, unitIds: [id], target: { x: 65, z: 70 } } }] }, { turn: 5, commands: [{ player: 2, command: { type: 'train' as const, buildingId: a.townCenterOf(2)!.id } }] }];
    for (let turn = 0; turn < 100; turn++) { const frame = history.find(f => f.turn === turn) ?? { turn, commands: [] }; applyTurn(a, frame); applyTurn(b, frame); if (turn % 25 === 0) expect(stateHash(a)).toBe(stateHash(b)); }
    const resumed = make(); await replay(resumed, history, 100);
    expect(stateHash(resumed)).toBe(stateHash(a));
  }, 15_000);
});
