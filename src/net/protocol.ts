import type { Action, Input, SimEvent, Team } from '../engine/sim';
import type { Attributes } from '../game/attributes';

// Messages between the host and guests. Each guest holds two connections to
// the host: 'control', reliable and ordered, for the room, events and team
// choices; and 'state', unordered, for inputs and snapshots, so a lost
// packet never holds up the ones behind it.

// Room codes are registered with the PeerJS broker under this prefix.
export const PEER_PREFIX = 'score-';
export const NAME_MAX = 16;

export interface MemberView {
  id: string;
  name: string;
  team: Team;
  connected: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  phase: 'lobby' | 'match';
  members: MemberView[];
}

export const ACTIONS: Action[] = ['none', 'charge', 'poke', 'slide', 'recover', 'stumble'];

// One player in a snapshot, packed to keep it small:
// [id, team (0 gold, 1 red), x, y, vx, vy, fx, fy, action, actionT, charge,
//  stamina, tired]
export type PlayerState = [
  string, 0 | 1, number, number, number, number, number, number, number, number, number, number, number,
];

export interface Snapshot {
  tick: number;
  ball: [number, number];
  owner: string | null;
  score: [number, number];
  players: PlayerState[];
}

export interface WireInput extends Input {
  // Increases with every input a guest sends; older ones arriving late are dropped.
  seq: number;
}

export type ToHost =
  | { t: 'hello'; id: string; name: string; attrs: Attributes }
  | { t: 'team'; team: Team }
  | { t: 'input'; input: WireInput };

export type ToClient =
  | { t: 'room'; room: RoomView }
  // What happened on a tick, for the guest to play when it draws that tick.
  | { t: 'events'; tick: number; events: SimEvent[] }
  | { t: 'snap'; snap: Snapshot }
  | { t: 'rejected'; reason: string };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  return Array.from(buf, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[\p{C}]/gu, '')
    .trim()
    .slice(0, NAME_MAX);
  return name || 'Player';
}

// Messages come from other browsers, so check the shapes we rely on.
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export const validTeam = (t: unknown): t is Team => t === 'gold' || t === 'red';

export function cleanInput(raw: unknown): WireInput | null {
  const i = raw as WireInput;
  if (!i || typeof i !== 'object' || !num(i.seq) || !num(i.x) || !num(i.y)) return null;
  return { seq: i.seq, x: clamp(i.x), y: clamp(i.y), kick: i.kick === true, sprint: i.sprint === true };
}
