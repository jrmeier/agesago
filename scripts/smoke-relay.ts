/** Verify a real relay with two independently simulated clients. Does not print seat tokens. */
import { WebSocket } from 'ws';
import { NETWORK_VERSION, HASH_EVERY, type MatchConfig, type ServerMessage } from '../src/network/protocol';
import { applyTurn, stateHash } from '../src/network/lockstep';
import { generateMap } from '../src/sim/mapgen';
import { World, defaultPlayers } from '../src/sim/World';

const endpoint = process.env.RELAY_SMOKE_URL ?? 'ws://127.0.0.1:8973/multiplayer';
const origin = process.env.RELAY_SMOKE_ORIGIN ?? 'http://localhost:4174';
const config: MatchConfig = { seed: 1, players: 2, mapSize: 'small', mapType: 'islands', civs: ['hellenes', 'romans'] };
const sockets: WebSocket[] = [];
const checks = new Map<number, string[]>();
let code = '';
let finished = 0;
let fail: (error: Error) => void = () => {};
const timeout = setTimeout(() => fail(new Error('Relay smoke timed out')), 40_000);

try {
  await new Promise<void>((resolve, reject) => {
    fail = reject;
    const connect = (player: number) => {
      const generated = generateMap(config.seed, config.players, { size: config.mapSize, type: config.mapType });
      const world = new World(generated.hf, generated.layout, defaultPlayers(2, config.civs).map(p => ({ ...p, control: 'human' })));
      world.seed = config.seed; world.mapOptions = { size: config.mapSize, type: config.mapType }; world.localPlayer = player;
      const socket = new WebSocket(endpoint, { origin }); sockets.push(socket);
      const submit = (turn: number) => {
        const commands = turn === 1 ? [{ type: 'train' as const, buildingId: world.townCenterOf(player)!.id }]
          : turn === 30 && player === 2 ? [{ type: 'resign' as const }] : [];
        const hash = turn % HASH_EVERY === 0 ? stateHash(world) : undefined;
        if (hash) { const values = checks.get(turn) ?? []; values.push(hash); checks.set(turn, values); }
        socket.send(JSON.stringify({ type: 'input', turn, commands, ...(hash ? { hash } : {}) }));
      };
      socket.on('open', () => socket.send(JSON.stringify(player === 1
        ? { type: 'create', version: NETWORK_VERSION, config, name: 'Relay QA host' }
        : { type: 'join', version: NETWORK_VERSION, code, name: 'Relay QA guest' })));
      socket.on('error', reject);
      socket.on('message', raw => {
        try {
          const message = JSON.parse(raw.toString()) as ServerMessage;
          if (message.type === 'welcome' && player === 1) { code = message.code; connect(2); }
          if (message.type === 'roster' && player === 1 && message.roster.length === 2) socket.send(JSON.stringify({ type: 'start' }));
          if (message.type === 'start') submit(message.turn);
          if (message.type === 'error' || message.type === 'desync') throw new Error(JSON.stringify(message));
          if (message.type === 'turn') {
            applyTurn(world, message);
            if (world.gameOver) {
              if (JSON.stringify(world.gameOver.winners) !== '[1]') throw new Error('Wrong match result');
              if (++finished === 2) resolve();
            } else submit(message.turn + 1);
          }
        } catch (error) { reject(error); }
      });
    };
    connect(1);
  });
  for (const [turn, values] of checks) if (values.length !== 2 || values[0] !== values[1]) throw new Error(`Checkpoint mismatch at turn ${turn}`);
  console.log(JSON.stringify({ endpoint, completedClients: finished, matchingCheckpoints: [...checks.keys()], winners: [1] }));
} finally { clearTimeout(timeout); for (const socket of sockets) socket.terminate(); }
