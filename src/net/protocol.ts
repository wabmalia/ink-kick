import type { Action, GoalRecord, Input, Rules, SimEvent, Team } from '../engine/sim';
import type { Attributes } from '../game/attributes';

// Messages between the host and guests. Each guest holds two connections to
// the host: 'control', reliable and ordered, for the room, events and team
// choices; and 'state', unordered, for inputs and snapshots. PeerJS's
// reliable:false only disables ordering, not retransmissions.

// Room codes are registered with the PeerJS broker under this prefix.
export const PEER_PREFIX = 'inkkick-';
export { NAME_MAX } from '@wabmalia/courier';
export const PROTOCOL_VERSION = 2;
export const VERSION_MESSAGE = 'Game versions differ. Refresh the game in every browser, then try again.';

export interface MemberView {
  id: string;
  name: string;
  team: Team;
  connected: boolean;
}

export interface RoomView {
  version: number;
  matchId: string | null;
  code: string;
  hostId: string;
  phase: 'lobby' | 'match';
  members: MemberView[];
  // How the next (or current) match is won, and whether it has goalkeepers;
  // the host picks.
  rules: Rules;
  keepers: boolean;
}

export const ACTIONS: Action[] = ['none', 'charge', 'poke', 'slide', 'recover', 'stumble'];

// One player in a snapshot, packed to keep it small:
// [id, team (0 gold, 1 red), x, y, vx, vy, fx, fy, action, actionT, charge,
//  stamina, tired, stumble (seconds the current stumble lasts, else 0),
//  sprinting (0 or 1)]
export type PlayerState = [
  string, 0 | 1, number, number, number, number, number, number, number, number, number, number, number, number, 0 | 1,
];

export interface Snapshot {
  matchId: string;
  tick: number;
  ball: [number, number];
  owner: string | null;
  score: [number, number];
  clock: number;
  players: PlayerState[];
}

/** Reliable baseline on joining/rejoining; visual events need not be replayed. */
export interface MatchSync {
  snap: Snapshot;
  goals: GoalRecord[];
  over: { winner: Team | null } | null;
  restartIn: number;
  holdFor: number;
  kickoffTeam: Team;
}

export interface WireInput extends Input {
  // Increases with every input a guest sends; older ones arriving late are dropped.
  seq: number;
}

export type ToHost =
  | { t: 'hello'; version: number; id: string; name: string; attrs: Attributes }
  | { t: 'team'; team: Team }
  // Attributes changed in the lobby; used from the next kickoff.
  | { t: 'attrs'; attrs: Attributes }
  // The guest's latest inputs, oldest first (see CONFIG.net.inputRepeat).
  | { t: 'input'; matchId: string; inputs: WireInput[] };

export type ToClient =
  | { t: 'room'; room: RoomView }
  | { t: 'sync'; sync: MatchSync }
  // What happened on a tick, for the guest to play when it draws that tick.
  | { t: 'events'; matchId: string; tick: number; events: SimEvent[] }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'rejected'; reason: string };

// Codes, names and ping grading are courier's, shared with the other arcade games.
export { cleanName, cleanPing, cleanPings, newRoomCode, normalizeCode, pingLevel, type PingLevel } from '@wabmalia/courier';

// Messages come from other browsers, so check the shapes we rely on.
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export const validTeam = (t: unknown): t is Team => t === 'gold' || t === 'red';

export function cleanInput(raw: unknown): WireInput | null {
  const i = raw as WireInput;
  if (!i || typeof i !== 'object' || !num(i.seq) || !num(i.x) || !num(i.y)) return null;
  return { seq: i.seq, x: clamp(i.x), y: clamp(i.y), kick: i.kick === true, sprint: i.sprint === true };
}

