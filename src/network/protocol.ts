import { CIV_IDS, type CivId } from '../core/civilizations';
import { MAP_SIZES, MAP_TYPES, type MapSize, type MapType } from '../core/maps';
import { BUILDINGS } from '../core/buildings';
import { TECHS } from '../core/techs';
import type { Command } from '../core/types';
import { UNITS } from '../core/units';

export const NETWORK_VERSION = 1;
export const TICKS_PER_TURN = 4;
export const HASH_EVERY = 25;
export const MAX_COMMANDS = 64;
export interface MatchConfig { seed: number; players: number; mapSize?: MapSize; mapType?: MapType; civs?: CivId[] }
export interface IssuedCommand { player: number; command: Command }
export interface Turn { turn: number; commands: IssuedCommand[] }
export interface RosterEntry { player: number; connected: boolean; name: string }
export type ServerMessage =
  | { type: 'welcome'; code: string; player: number; token: string; host: boolean; config: MatchConfig; roster: RosterEntry[] }
  | { type: 'roster'; roster: RosterEntry[] }
  | { type: 'start'; config: MatchConfig; turn: number; history: Turn[] }
  | ({ type: 'turn' } & Turn)
  | { type: 'waiting'; text: string }
  | { type: 'error'; text: string }
  | { type: 'desync'; turn: number };
export type ClientMessage =
  | { type: 'create'; version: number; config: MatchConfig; name: string }
  | { type: 'join'; version: number; code: string; name: string; token?: string }
  | { type: 'start' }
  | { type: 'input'; turn: number; commands: Command[]; hash?: string };

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const index = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) < 1000;
const point = (v: unknown): boolean => object(v) && ['x', 'z'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]) && Math.abs(Number(v[k])) <= 1000);
const ids = (v: unknown): boolean => Array.isArray(v) && v.length <= 512 && v.every(id);
const resource = (v: unknown): boolean => ['wood', 'food', 'gold', 'stone'].includes(String(v));

/** Reject malformed input before any peer applies it to its simulation. */
export function validCommand(v: unknown): v is Command {
  if (!object(v) || typeof v.type !== 'string') return false;
  if ('unitIds' in v && !ids(v.unitIds)) return false;
  switch (v.type) {
    case 'move': case 'attackMove': return ids(v.unitIds) && point(v.target);
    case 'gather': return ids(v.unitIds) && id(v.nodeId);
    case 'heal': case 'convert':
    case 'attack': return ids(v.unitIds) && id(v.targetId);
    case 'stop': case 'explore': return ids(v.unitIds);
    case 'stance': return ids(v.unitIds) && ['aggressive', 'defensive', 'standGround', 'passive'].includes(String(v.stance));
    case 'train': return id(v.buildingId) && (v.unit === undefined || typeof v.unit === 'string' && Object.hasOwn(UNITS, v.unit));
    case 'cancelTrain': case 'cancelResearch': return id(v.buildingId) && index(v.index);
    case 'construct': case 'garrison': return ids(v.unitIds) && id(v.buildingId);
    case 'cancelBuild': case 'ungarrison': return id(v.buildingId);
    case 'resign': case 'townBell': return true;
    case 'rally': return id(v.buildingId) && point(v.pos) && (v.targetId === undefined || id(v.targetId));
    case 'build': return ids(v.unitIds) && typeof v.kind === 'string' && Object.hasOwn(BUILDINGS, v.kind) && point(v.pos) && typeof v.rot === 'number' && Number.isFinite(v.rot);
    case 'buildWall': return ids(v.unitIds) && ['palisade', 'stoneWall'].includes(String(v.kind)) && point(v.from) && point(v.to);
    case 'research': return id(v.buildingId) && typeof v.tech === 'string' && Object.hasOwn(TECHS, v.tech);
    case 'marketTrade': return ['wood', 'food', 'stone'].includes(String(v.resource)) && ['buy', 'sell'].includes(String(v.side));
    case 'tribute': return id(v.to) && Number(v.to) <= 4 && resource(v.resource) && typeof v.amount === 'number' && Number.isFinite(v.amount) && v.amount > 0 && v.amount <= 1e8;
    case 'trade': return ids(v.unitIds) && id(v.marketId);
    case 'navalTrade': return ids(v.unitIds) && id(v.dockId);
    case 'loadTransport': return ids(v.unitIds) && id(v.transportId);
    case 'unloadTransport': return id(v.transportId) && point(v.target);
    default: return false;
  }
}

export function validConfig(v: unknown): v is MatchConfig {
  return object(v) && Number.isSafeInteger(v.seed) && Number(v.seed) >= 1 && Number(v.seed) <= 1e9
    && Number.isInteger(v.players) && Number(v.players) >= 2 && Number(v.players) <= 4
    && (v.mapSize === undefined || typeof v.mapSize === 'string' && Object.hasOwn(MAP_SIZES, v.mapSize))
    && (v.mapType === undefined || MAP_TYPES.includes(v.mapType as MapType))
    && (v.civs === undefined || Array.isArray(v.civs) && v.civs.length === v.players && v.civs.every(c => CIV_IDS.includes(c as CivId)));
}

export function validClientMessage(v: unknown): v is ClientMessage {
  if (!object(v)) return false;
  switch (v.type) {
    case 'create': return v.version === NETWORK_VERSION && validConfig(v.config) && typeof v.name === 'string' && v.name.length <= 32;
    case 'join': return v.version === NETWORK_VERSION && typeof v.code === 'string' && /^[A-Z0-9]{6}$/.test(v.code) && typeof v.name === 'string' && v.name.length <= 32 && (v.token === undefined || typeof v.token === 'string' && /^[a-f0-9]{48}$/.test(v.token));
    case 'start': return true;
    case 'input': return Number.isSafeInteger(v.turn) && Number(v.turn) >= 0 && Array.isArray(v.commands) && v.commands.length <= MAX_COMMANDS && v.commands.every(validCommand) && (v.hash === undefined || typeof v.hash === 'string' && /^[a-f0-9]{8}$/.test(v.hash));
    default: return false;
  }
}
