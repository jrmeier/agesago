import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { HASH_EVERY, TICKS_PER_TURN, validClientMessage, type ClientMessage, type MatchConfig, type ServerMessage, type Turn } from './protocol';
import { BALANCE } from '../sim/balance';

interface Seat { player: number; name: string; token: string; socket: WebSocket | null; input?: Extract<ClientMessage, { type: 'input' }>; dropped: boolean; timer?: ReturnType<typeof setTimeout> }
interface Room { code: string; config: MatchConfig; seats: Seat[]; started: boolean; halted: boolean; turn: number; history: Turn[]; historyBytes: number; resigns: number[]; lastActive: number }
export interface RelayOptions { origins?: string[]; reconnectMs?: number; turnMs?: number; maxRooms?: number }

/** The relay orders commands; it never accepts a player id from a client. */
export function createRelayServer(options: RelayOptions = {}) {
  const rooms = new Map<string, Room>();
  const origins = new Set(options.origins ?? ['https://agesago.jedm.dev', 'http://localhost:4174', 'http://localhost:5173']);
  const reconnectMs = options.reconnectMs ?? 30_000;
  const server = createServer((request, response) => {
    if (request.url !== '/multiplayer/health') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true, protocol: 1, rooms: rooms.size }));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const send = (socket: WebSocket | null, message: ServerMessage) => {
    if (socket?.readyState === WebSocket.OPEN) {
      if (socket.bufferedAmount > 4 * 1024 * 1024) { socket.close(1008, 'Client is too slow'); return; }
      socket.send(JSON.stringify(message));
    }
  };
  const broadcast = (room: Room, message: ServerMessage) => { for (const seat of room.seats) if (!seat.dropped) send(seat.socket, message); };
  const roster = (room: Room) => room.seats.filter(s => !s.dropped).map(s => ({ player: s.player, connected: s.socket?.readyState === WebSocket.OPEN, name: s.name }));
  const error = (socket: WebSocket, text: string) => send(socket, { type: 'error', text });

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/multiplayer' || !origins.has(request.headers.origin ?? '') || sockets.clients.size >= 128) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, connection => sockets.emit('connection', connection));
  });

  sockets.on('connection', socket => {
    let room: Room | undefined;
    let seat: Seat | undefined;
    let alive = true;
    let windowStart = Date.now();
    let messageCount = 0;
    const authenticate = (target: Room, slot: Seat) => {
      room = target; seat = slot;
      if (slot.socket && slot.socket !== socket) slot.socket.close(1008, 'Session resumed elsewhere');
      clearTimeout(slot.timer); slot.timer = undefined;
      slot.socket = socket; slot.input = undefined;
      target.lastActive = Date.now();
      send(socket, { type: 'welcome', code: target.code, player: slot.player, token: slot.token, host: slot.player === 1, config: target.config, roster: roster(target) });
      broadcast(target, { type: 'roster', roster: roster(target) });
      if (target.started) send(socket, { type: 'start', config: target.config, turn: target.turn, history: target.history });
    };
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false; socket.ping();
    }, 15_000);
    socket.on('message', (raw, binary) => {
      if (Date.now() - windowStart > 1000) { windowStart = Date.now(); messageCount = 0; }
      if (binary || ++messageCount > 40) { socket.close(1008, 'Invalid message rate'); return; }
      let message: unknown;
      try { message = JSON.parse(raw.toString()); } catch { error(socket, 'Invalid message.'); return; }
      if (!validClientMessage(message)) { error(socket, 'Unsupported or invalid command. Refresh both browsers to the same game version.'); return; }
      const m = message;
      if (m.type === 'create') {
        if (room || rooms.size >= (options.maxRooms ?? 32)) { error(socket, 'Cannot create another room.'); return; }
        let code: string;
        do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
        const newRoom: Room = { code, config: structuredClone(m.config), seats: [], started: false, halted: false, turn: 0, history: [], historyBytes: 0, resigns: [], lastActive: Date.now() };
        const host: Seat = { player: 1, name: m.name.trim() || 'Player 1', token: randomBytes(24).toString('hex'), socket: null, dropped: false };
        newRoom.seats.push(host); rooms.set(code, newRoom); authenticate(newRoom, host); return;
      }
      if (m.type === 'join') {
        if (room) { error(socket, 'Already in a room.'); return; }
        const target = rooms.get(m.code);
        if (!target || target.halted) { error(socket, 'That room is unavailable.'); return; }
        const old = m.token ? target.seats.find(s => s.token === m.token && !s.dropped) : undefined;
        if (m.token && !old) { error(socket, 'This seat has expired.'); return; }
        if (old) { authenticate(target, old); return; }
        if (target.started || target.seats.length >= target.config.players) { error(socket, 'That room is full or already started.'); return; }
        const used = new Set(target.seats.map(s => s.player));
        let player = 1; while (used.has(player)) player++;
        const guest: Seat = { player, name: m.name.trim() || `Player ${player}`, token: randomBytes(24).toString('hex'), socket: null, dropped: false };
        target.seats.push(guest); target.seats.sort((a, b) => a.player - b.player); authenticate(target, guest); return;
      }
      if (!room || !seat || seat.socket !== socket || seat.dropped) { error(socket, 'Join a room first.'); return; }
      room.lastActive = Date.now();
      if (m.type === 'start') {
        if (seat.player !== 1 || room.started || room.seats.length !== room.config.players || room.seats.some(s => s.socket?.readyState !== WebSocket.OPEN)) { error(socket, 'The host can start when every seat is connected.'); return; }
        room.started = true; broadcast(room, { type: 'start', config: room.config, turn: 0, history: [] }); return;
      }
      if (m.type === 'input') {
        if (!room.started || room.halted || m.turn !== room.turn || seat.input || (m.turn % HASH_EVERY === 0 && m.hash === undefined)) { error(socket, 'Invalid turn.'); return; }
        seat.input = structuredClone(m);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearInterval(heartbeat);
      if (!room || !seat || seat.socket !== socket) return;
      const target = room, slot = seat;
      slot.socket = null; slot.input = undefined;
      broadcast(target, { type: 'roster', roster: roster(target) });
      if (target.started) broadcast(target, { type: 'waiting', text: `${slot.name} disconnected. Waiting ${Math.ceil(reconnectMs / 1000)} seconds for reconnect…` });
      slot.timer = setTimeout(() => {
        if (slot.socket) return;
        if (target.started) { slot.dropped = true; target.resigns.push(slot.player); }
        else target.seats = target.seats.filter(s => s !== slot);
        broadcast(target, { type: 'roster', roster: roster(target) });
        broadcast(target, { type: 'waiting', text: `${slot.name} left the match.` });
        if (!target.seats.some(s => s.socket)) rooms.delete(target.code);
      }, reconnectMs);
    });
  });

  const turns = setInterval(() => {
    for (const room of rooms.values()) {
      if (Date.now() - room.lastActive > 10 * 60_000) { for (const seat of room.seats) seat.socket?.close(1001, 'Room expired'); rooms.delete(room.code); continue; }
      if (!room.started || room.halted) continue;
      const active = room.seats.filter(s => !s.dropped);
      if (!active.length || active.some(s => !s.input || s.socket?.readyState !== WebSocket.OPEN)) continue;
      if (room.turn % HASH_EVERY === 0 && new Set(active.map(s => s.input!.hash)).size !== 1) {
        room.halted = true; broadcast(room, { type: 'desync', turn: room.turn }); continue;
      }
      const frame: Turn = { turn: room.turn, commands: active.flatMap(s => s.input!.commands.map(command => ({ player: s.player, command }))) };
      for (const player of room.resigns.splice(0)) frame.commands.unshift({ player, command: { type: 'resign' } });
      if (frame.commands.length) { room.history.push(frame); room.historyBytes += JSON.stringify(frame).length; }
      if (room.historyBytes > 2 * 1024 * 1024 || room.history.length > 20_000 || room.turn >= 100_000) { room.halted = true; broadcast(room, { type: 'error', text: 'This match reached the relay session limit.' }); continue; }
      room.turn++;
      for (const s of active) s.input = undefined;
      broadcast(room, { type: 'turn', ...frame });
    }
  }, options.turnMs ?? 1000 * TICKS_PER_TURN / BALANCE.tickRate);

  return {
    server, rooms,
    async close() {
      clearInterval(turns);
      for (const room of rooms.values()) for (const seat of room.seats) clearTimeout(seat.timer);
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
