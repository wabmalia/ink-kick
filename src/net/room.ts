import { CONFIG } from '../config';
import {
  addPlayer, createMatch, createPlayer, step,
  type Input, type Match, type SimEvent, type Team,
} from '../engine/sim';
import { toSnapshot } from '../game/state';
import { cleanName, type MemberView, type RoomView, type ToClient, type WireInput } from './protocol';

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
  link: Link | null;
  input: WireInput | null;
}

const NO_INPUT: Input = { x: 0, y: 0, kick: false, sprint: false };

export class HostRoom {
  private members: Member[] = [];
  phase: RoomView['phase'] = 'lobby';
  match: Match | null = null;
  tick = 0;

  constructor(readonly code: string, readonly hostId: string, hostName: string, private listener: RoomListener) {
    this.members.push({ id: hostId, name: cleanName(hostName), team: 'gold', connected: true, link: null, input: null });
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      members: this.members.map(({ id, name, team, connected }) => ({ id, name, team, connected })),
    };
  }

  private changed() {
    const room = this.view();
    for (const m of this.members) m.link?.send({ t: 'room', room });
    this.listener.change(room);
  }

  // A new guest goes on the team with fewer players; a returning one keeps
  // their place.
  join(id: string, name: string, link: Link) {
    let m = this.members.find(x => x.id === id);
    if (m) {
      Object.assign(m, { name: cleanName(name), connected: true, link, input: null });
    } else {
      const gold = this.members.filter(x => x.team === 'gold').length;
      const red = this.members.length - gold;
      m = { id, name: cleanName(name), team: red < gold ? 'red' : 'gold', connected: true, link, input: null };
      this.members.push(m);
    }
    if (this.match && !this.match.players.some(p => p.id === id)) addPlayer(this.match, createPlayer(id, m.team));
    this.changed();
  }

  // Their player stays on the pitch, standing still, until they come back.
  disconnect(id: string, link: Link) {
    const m = this.members.find(x => x.id === id);
    if (!m || m.link !== link) return;
    Object.assign(m, { connected: false, link: null, input: null });
    this.changed();
  }

  setTeam(id: string, team: Team) {
    const m = this.members.find(x => x.id === id);
    if (!m || m.team === team || this.phase !== 'lobby') return;
    m.team = team;
    this.changed();
  }

  input(id: string, input: WireInput) {
    const m = this.members.find(x => x.id === id);
    if (m && (!m.input || input.seq > m.input.seq)) m.input = input;
  }

  start() {
    if (this.phase !== 'lobby') return;
    // Anyone who left in the lobby is gone for good.
    this.members = this.members.filter(m => m.connected);
    this.phase = 'match';
    this.tick = 0;
    this.match = createMatch(this.members.map(m => createPlayer(m.id, m.team)));
    this.changed();
  }

  end() {
    if (this.phase !== 'match') return;
    this.phase = 'lobby';
    this.match = null;
    this.changed();
  }

  // One tick of the match, with the host's own input; sends the guests what
  // happened and, every few ticks, where everything is.
  step(hostInput: Input): SimEvent[] {
    const match = this.match;
    if (!match) return [];
    const inputs: Record<string, Input> = {};
    for (const m of this.members) inputs[m.id] = m.id === this.hostId ? hostInput : m.input ?? NO_INPUT;
    const events = step(match, inputs);
    this.tick++;
    if (events.length) {
      const msg: ToClient = { t: 'events', tick: this.tick, events };
      for (const m of this.members) m.link?.send(msg);
    }
    if (this.tick % CONFIG.net.snapshotEvery === 0) {
      const msg: ToClient = { t: 'snap', snap: toSnapshot(match, this.tick) };
      for (const m of this.members) m.link?.sendState(msg);
    }
    return events;
  }
}
