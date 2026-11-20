import { CONFIG } from '../config';
import {
  addPlayer, createMatch, createPlayer, step,
  type Input, type Match, type Rules, type SimEvent, type Team,
} from '../engine/sim';
import { NO_INPUT } from '../engine/input';
import { cleanRules } from '../game/rules';
import { toSnapshot } from '../game/state';
import { cleanAttributes, type Attributes } from '../game/attributes';
import { PROTOCOL_VERSION, cleanName, type MatchSync, type MemberView, type RoomView, type ToClient, type WireInput } from './protocol';

// The room as the host runs it: who's in, on which team, and the match once
// it kicks off. It knows nothing about PeerJS; each guest is a Link.

export interface Link {
  // Reliable, in order.
  send(msg: ToClient): void;
  // Unordered; may be lost.
  sendState(msg: ToClient): void;
}

export interface RoomListener {
  change(room: RoomView): void;
}

interface Member extends MemberView {
  attrs: Attributes;
  link: Link | null;
  // The input being played, and newer ones not played yet, oldest first.
  input: WireInput | null;
  pending: WireInput[];
  inputTick: number;
  // Their reported round trip to the host, in ms.
  ping: number | null;
}


export class HostRoom {
  private members: Member[] = [];
  phase: RoomView['phase'] = 'lobby';
  rules: Rules = cleanRules(null);
  keepers = false;
  match: Match | null = null;
  tick = 0;
  matchId: string | null = null;

  constructor(readonly code: string, readonly hostId: string, hostName: string, private listener: RoomListener, hostAttrs?: Attributes) {
    this.members.push({ id: hostId, name: cleanName(hostName), attrs: cleanAttributes(hostAttrs), team: 'gold', connected: true, link: null, input: null, pending: [], inputTick: 0, ping: null });
  }

  view(): RoomView {
    return {
      version: PROTOCOL_VERSION,
      matchId: this.matchId,
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      members: this.members.map(({ id, name, team, connected }) => ({ id, name, team, connected })),
      rules: this.rules,
      keepers: this.keepers,
    };
  }

  private changed() {
    const room = this.view();
    for (const m of this.members) m.link?.send({ t: 'room', room });
    this.listener.change(room);
  }

  private member(id: string) {
    return this.members.find(x => x.id === id);
  }

  // A new guest goes on the team with fewer players; a returning one keeps
  // their place.
  join(id: string, name: string, link: Link, attrs?: unknown) {
    let m = this.member(id);
    if (m) {
      Object.assign(m, { name: cleanName(name), attrs: cleanAttributes(attrs), connected: true, link, input: null, pending: [], ping: null });
    } else {
      const gold = this.members.filter(x => x.team === 'gold').length;
      const red = this.members.length - gold;
      m = { id, name: cleanName(name), attrs: cleanAttributes(attrs), team: red < gold ? 'red' : 'gold', connected: true, link, input: null, pending: [], inputTick: this.tick, ping: null };
      this.members.push(m);
    }
    if (this.match && !this.match.players.some(p => p.id === id)) addPlayer(this.match, createPlayer(id, m.team, m.attrs));
    this.changed();
    const sync = this.sync();
    if (sync) link.send({ t: 'sync', sync });
  }

  sync(): MatchSync | null {
    if (!this.match || !this.matchId) return null;
    const m = this.match;
    return { snap: toSnapshot(m, this.tick, this.matchId), goals: m.goals.map(g => ({ ...g })),
      over: m.over ? { ...m.over } : null, restartIn: m.restartIn, holdFor: m.holdFor, kickoffTeam: m.kickoffTeam };
  }

  // Their player stays on the pitch, standing still, until they come back.
  disconnect(id: string, link: Link) {
    const m = this.member(id);
    if (!m || m.link !== link) return;
    Object.assign(m, { connected: false, link: null, input: null, pending: [], ping: null });
    this.changed();
  }

  setTeam(id: string, team: Team) {
    const m = this.member(id);
    if (!m || m.team === team || this.phase !== 'lobby') return;
    m.team = team;
    this.changed();
  }

  // Attributes changed in the lobby count from the next kickoff; a match on
  // keeps the ones it started with.
  setAttributes(id: string, attrs: unknown) {
    const m = this.member(id);
    if (!m || this.phase !== 'lobby') return;
    m.attrs = cleanAttributes(attrs);
  }

  setRules(rules: Rules) {
    if (this.phase !== 'lobby') return;
    this.rules = cleanRules(rules);
    this.changed();
  }

  setKeepers(on: boolean) {
    if (this.phase !== 'lobby') return;
    this.keepers = on;
    this.changed();
  }

  // Inputs are queued, not just the newest kept: two arriving within one
  // tick would otherwise lose the first, and with it a quick kick tap.
  input(id: string, input: WireInput) {
    const m = this.member(id);
    if (!m?.connected) return;
    const newest = m.pending[m.pending.length - 1] ?? m.input;
    if (newest && input.seq <= newest.seq) return;
    m.pending.push(input);
    m.inputTick = this.tick;
    // Too many waiting: merge away movement-only ones, oldest first.
    while (m.pending.length > CONFIG.net.inputQueue) {
      const i = m.pending.findIndex((p, k) => k + 1 < m.pending.length && p.kick === m.pending[k + 1]!.kick);
      m.pending.splice(Math.max(0, i), 1);
    }
  }

  // The input a guest plays this tick: the next one that presses or
  // releases kick, so every press and release lands on a tick of its own;
  // otherwise the newest, as movement only needs the latest.
  private nextInput(m: Member) {
    if (!m.pending.length) return;
    const kick = m.input?.kick ?? false;
    const edge = m.pending.findIndex(p => p.kick !== kick);
    const take = edge === -1 ? m.pending.length - 1 : edge;
    m.input = m.pending[take]!;
    m.pending.splice(0, take + 1);
  }

  setPing(id: string, ms: number | null) {
    const m = this.member(id);
    if (m?.connected && id !== this.hostId && ms !== null) m.ping = ms;
  }

  /** Every connected guest's round trip; tells the guests too. */
  sendPings(): Record<string, number> {
    const pings: Record<string, number> = {};
    for (const m of this.members) if (m.connected && m.ping !== null) pings[m.id] = m.ping;
    const msg: ToClient = { t: 'pings', pings };
    for (const m of this.members) m.link?.send(msg);
    return pings;
  }

  start() {
    if (this.phase !== 'lobby') return;
    // Anyone who left in the lobby is gone for good.
    this.members = this.members.filter(m => m.connected);
    this.matchId = crypto.randomUUID();
    this.phase = 'match';
    this.tick = 0;
    for (const m of this.members) {
      m.inputTick = -Infinity;
      // Unplayed ones go, but their sequence stays the one to beat.
      m.input = m.pending[m.pending.length - 1] ?? m.input;
      m.pending = [];
    }
    const kickoff = Math.random() < 0.5 ? 'gold' : 'red';
    this.match = createMatch(this.members.map(m => createPlayer(m.id, m.team, m.attrs)), { kickoff, coin: true, rules: this.rules, keepers: this.keepers });
    this.changed();
    const sync = this.sync()!;
    for (const m of this.members) m.link?.send({ t: 'sync', sync });
  }

  end() {
    if (this.phase !== 'match') return;
    this.phase = 'lobby';
    this.matchId = null;
    this.match = null;
    this.changed();
  }

  // One tick of the match, with the host's own input; sends the guests what
  // happened and, every few ticks, where everything is.
  step(hostInput: Input): SimEvent[] {
    const match = this.match;
    if (!match) return [];
    const inputs: Record<string, Input> = {};
    for (const m of this.members) if (m.id !== this.hostId) this.nextInput(m);
    // A silent connection must not leave a player sprinting or charging
    // forever. Keep the sequence number so delayed packets stay rejected.
    for (const m of this.members) inputs[m.id] = m.id === this.hostId ? hostInput
      : (this.tick - m.inputTick) * CONFIG.tick < 0.5 ? m.input ?? NO_INPUT : NO_INPUT;
    const events = step(match, inputs);
    this.tick++;
    if (events.length) {
      const msg: ToClient = { t: 'events', matchId: this.matchId!, tick: this.tick, events };
      for (const m of this.members) m.link?.send(msg);
    }
    if (this.tick % CONFIG.net.snapshotEvery === 0) {
      const msg: ToClient = { t: 'snap', snap: toSnapshot(match, this.tick, this.matchId!) };
      for (const m of this.members) m.link?.sendState(msg);
    }
    return events;
  }
}
