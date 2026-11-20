import { host, join, tabId, type Guest, type GuestStatus, type Host, type Link, type LinkHandlers } from '@wabmalia/courier';
import { CONFIG } from '../config';
import type { Input, Rules, SimEvent, Team } from '../engine/sim';
import { loadKeepers, loadRules, saveKeepers, saveRules } from '../game/rules';
import { iceServers } from './relay';
import {
  cleanInput, cleanName, newRoomCode, PEER_PREFIX, PROTOCOL_VERSION, VERSION_MESSAGE, validTeam,
  type MatchSync, type RoomView, type Snapshot, type ToClient, type ToHost, type WireInput,
} from './protocol';
import { HostRoom } from './room';
import { loadAttributes, type Attributes } from '../game/attributes';
import { KEYS, store } from '../storage';

// The connection side. Courier (@wabmalia/courier) does the connecting: the
// room code, both channels (reliable "control" for the room, events and
// choices; unordered "state" for inputs and snapshots, see protocol.ts),
// heartbeats, reconnects, pings and the relay. This keeps what's Ink Kick's:
// the host room, what the messages mean, the match baseline, and spotting a
// host whose simulation stalled. Screens listen for changes.

export type Status = 'home' | 'connecting' | 'room' | 'solo' | 'training' | 'error';

export interface SessionListener {
  change?(): void;
  snap?(snap: Snapshot): void;
  sync?(sync: MatchSync): void;
  events?(tick: number, events: SimEvent[]): void;
  /** Everyone's round trip to the host changed (see Session.pings). */
  pings?(): void;
}

/** How often a guest checks the host's simulation is still sending snapshots. */
const STALL_CHECK_MS = 1000;
/** No snapshot for this long, while the host's simulation has moved on: start again. */
const SNAPSHOT_SILENCE_MS = 8000;

/** What the host adds to its heartbeat replies: how far its match has got. */
interface Beat {
  tick: number;
  matchId: string | null;
}

export class Session {
  status: Status = 'home';
  message = '';
  role: 'host' | 'client' | null = null;
  code = '';
  /** Per-tab identity, so a refresh reclaims the same player but two tabs are two players. */
  me = tabId(KEYS.id);
  room: RoomView | null = null;
  /** False while a guest is reconnecting to the host. */
  linked = true;
  name = store.get(localStorage, KEYS.name) ?? '';
  host: HostRoom | null = null;
  /**
   * Each connected guest's round trip to the host, in ms, by id. The host
   * has none of its own: everyone plays through it, so a guest's number is
   * the line between them and the host. One high number is that guest's
   * connection; everyone high is the host's.
   */
  pings: Record<string, number> = {};

  private listeners = new Set<SessionListener>();
  private hosting: Host | null = null;
  private guest: Guest<ToHost> | null = null;
  /** Each guest's current link, by player id, so a returning one replaces the old. */
  private links = new Map<string, Link<ToClient>>();
  private seq = 0;
  /** The latest inputs sent, repeated in each packet. */
  private recentInputs: WireInput[] = [];
  private stallCheck: ReturnType<typeof setInterval> | undefined;

  listen(l: SessionListener) {
    this.listeners.add(l);
  }

  private emit<K extends keyof SessionListener>(kind: K, ...args: Parameters<NonNullable<SessionListener[K]>>) {
    for (const l of this.listeners) (l[kind] as ((...a: unknown[]) => void) | undefined)?.(...args);
  }

  private set(patch: Partial<Pick<Session, 'status' | 'message' | 'room' | 'linked'>>) {
    Object.assign(this, patch);
    this.emit('change');
  }

  setName(name: string) {
    this.name = cleanName(name);
    store.set(localStorage, KEYS.name, this.name);
  }

  get isHost() {
    return this.role === 'host';
  }

  // How the solo match is won, and which one this is: Play again starts a
  // fresh one with the same rules.
  soloRules: Rules = loadRules();
  soloKeepers = loadKeepers();
  soloRound = 0;

  playSolo(rules: Rules = this.soloRules) {
    this.teardown();
    this.soloRules = rules;
    saveRules(rules);
    this.soloRound++;
    this.set({ status: 'solo' });
    location.hash = '#/solo';
  }

  train() {
    this.teardown();
    this.set({ status: 'training' });
    location.hash = '#/train';
  }

  // Hosting ---------------------------------------------------------------

  /** Create a room, or reopen the one this tab was hosting before a refresh. */
  hostRoom(resumeCode?: string) {
    this.teardown();
    const code = resumeCode ?? newRoomCode();
    this.role = 'host';
    this.code = code;
    const room = new HostRoom(code, this.me, this.name || 'Host', { change: view => this.set({ room: view }) }, loadAttributes());
    this.host = room;
    room.setRules(loadRules());
    room.setKeepers(loadKeepers());
    store.set(sessionStorage, KEYS.host, code);
    this.set({ status: 'connecting', message: resumeCode ? 'Reopening your room…' : 'Creating room…', room: room.view() });
    this.hosting = host<ToClient>({
      prefix: PEER_PREFIX,
      code,
      fresh: !resumeCode,
      iceServers: () => iceServers(),
      attach: link => this.attachGuest(room, link),
      open: () => {
        this.set({ status: 'room' });
        location.hash = `#/host/${code}`;
      },
      // Code collision on a brand new room: just pick another.
      codeTaken: () => this.hostRoom(),
      notice: text => {
        if (this.status !== 'room') this.set({ message: text });
      },
      fail: message => this.fail(message),
      pings: pings => {
        this.pings = pings;
        this.emit('pings');
      },
      beat: (): Beat => ({ tick: room.tick, matchId: room.matchId }),
    });
  }

  // A guest's hello says who they are; until then nothing else counts.
  private attachGuest(room: HostRoom, link: Link<ToClient>): LinkHandlers {
    let id: string | null = null;
    return {
      message: raw => {
        if (this.host !== room) return;
        const msg = raw as ToHost;
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'hello' && !id && typeof msg.id === 'string' && msg.id && msg.id !== this.me) {
          if (msg.version !== PROTOCOL_VERSION) {
            link.send({ t: 'rejected', reason: VERSION_MESSAGE });
            link.close();
            return;
          }
          id = msg.id;
          const old = this.links.get(id);
          this.links.set(id, link);
          room.join(id, cleanName(msg.name), link, msg.attrs);
          // The same player from a new connection: the old one is done.
          if (old !== link) old?.close();
          return;
        }
        if (!id || this.links.get(id) !== link) return;
        if (msg.t === 'team' && validTeam(msg.team)) room.setTeam(id, msg.team);
        else if (msg.t === 'attrs') room.setAttributes(id, msg.attrs);
        else if (msg.t === 'input' && msg.matchId === room.matchId && Array.isArray(msg.inputs)) {
          for (const rawInput of msg.inputs.slice(-CONFIG.net.inputRepeat)) {
            const input = cleanInput(rawInput);
            if (input) room.input(id, input);
          }
        }
      },
      closed: () => {
        if (!id || this.links.get(id) !== link) return;
        this.links.delete(id);
        room.disconnect(id, link);
      },
    };
  }

  setTeam(team: Team) {
    if (this.host) this.host.setTeam(this.me, team);
    else this.guest?.send({ t: 'team', team });
  }

  /** Attributes changed in the lobby, for the next kickoff. */
  setAttributes(attrs: Attributes) {
    if (this.status !== 'room') return;
    if (this.host) this.host.setAttributes(this.me, attrs);
    else this.guest?.send({ t: 'attrs', attrs });
  }

  start() {
    this.host?.start();
  }

  /** Goalkeepers in solo, remembered for next time. */
  setSoloKeepers(on: boolean) {
    this.soloKeepers = on;
    saveKeepers(on);
  }

  /** The host picks whether the next match has goalkeepers. */
  setKeepers(on: boolean) {
    if (!this.host) return;
    saveKeepers(on);
    this.host.setKeepers(on);
  }

  /** The host picks how the next match is won. */
  setRules(rules: Rules) {
    if (!this.host) return;
    saveRules(rules);
    this.host.setRules(rules);
  }

  end() {
    this.host?.end();
  }

  // Joining ---------------------------------------------------------------

  private courierLinked = false;
  private lastSnapshotAt = 0;
  private snapshotTick = -1;
  private hostTick = -1;
  private syncedMatchId: string | null = null;
  /** The tick of the latest sync; nothing older can help the match. */
  private baselineTick = -1;
  private eventTick = -1;
  private jitterMs = 0;
  private previousSnapshot: { tick: number; at: number } | null = null;

  joinRoom(code: string) {
    this.teardown();
    this.role = 'client';
    this.code = code;
    this.set({ status: 'connecting', message: `Looking for room ${code}…`, linked: false });
    store.set(sessionStorage, KEYS.joined, code);
    const me = this.me;
    this.guest = join<ToClient, ToHost>({
      prefix: PEER_PREFIX,
      code,
      id: me,
      realtime: true,
      hello: () => ({ t: 'hello', version: PROTOCOL_VERSION, id: me, name: this.name || 'Player', attrs: loadAttributes() }),
      message: (msg, channel) => {
        if (!msg || typeof msg !== 'object') return;
        if (channel === 'state') {
          if (msg.t === 'snap') this.snapshot(msg.snap);
        } else {
          this.receive(msg);
        }
        this.markLinked();
      },
      status: s => this.guestStatus(s),
      fail: message => this.fail(message),
      pings: pings => {
        this.pings = pings;
        this.emit('pings');
      },
      beat: data => this.hostBeat(data),
      iceServers: () => iceServers(),
    });
    this.stallCheck = setInterval(() => this.checkStall(), STALL_CHECK_MS);
  }

  private guestStatus(s: GuestStatus) {
    this.courierLinked = s === 'linked';
    // A new attempt starts from nothing: wait for the room and a baseline.
    if (s === 'reconnecting') {
      this.freshAttempt();
      this.set({ linked: false });
    }
    this.markLinked();
  }

  private freshAttempt() {
    this.courierLinked = false;
    this.lastSnapshotAt = performance.now();
    this.snapshotTick = this.hostTick = -1;
    this.syncedMatchId = null;
    this.previousSnapshot = null;
    this.jitterMs = 0;
  }

  /** The host's heartbeat reply says how far its match has got. */
  private hostBeat(data: unknown) {
    const beat = data as Beat | null;
    if (!beat || !Number.isSafeInteger(beat.tick) || beat.tick < 0) return;
    if (beat.matchId === this.room?.matchId) this.hostTick = Math.max(this.hostTick, beat.tick);
  }

  // A backgrounded host may stop simulating, but still answer pings. Only
  // call snapshots stalled when its simulation has passed the point where
  // another one was due: a host stopped between two snapshots is a tick or
  // so ahead of the last one, and that's no stall.
  private checkStall() {
    if (!this.guest || !this.courierLinked || this.room?.phase !== 'match') return;
    if (this.hostTick - this.snapshotTick >= CONFIG.net.snapshotEvery
      && performance.now() - this.lastSnapshotAt >= SNAPSHOT_SILENCE_MS) {
      this.guest.reconnect('snapshot-timeout');
    }
  }

  /** Safe to share: no candidate addresses or relay credentials. */
  async diagnostics() {
    const net = await this.guest?.diagnostics();
    return {
      linked: this.linked, matchId: this.room?.matchId ?? null,
      reconnectCount: net?.reconnectCount ?? 0, reconnectReason: net?.reconnectReason ?? null,
      snapshotAgeMs: this.previousSnapshot ? performance.now() - this.lastSnapshotAt : null,
      snapshotJitterMs: this.jitterMs,
      control: net?.control ?? null,
      state: net?.state ?? null,
    };
  }

  private snapshot(snap: Snapshot) {
    if (!snap || !Number.isSafeInteger(snap.tick) || snap.tick < 0) return;
    if (snap.matchId !== this.room?.matchId || snap.matchId !== this.syncedMatchId || snap.tick <= this.baselineTick) return;
    // Only a newer snapshot shows the host is still getting through; a late
    // one (state is unordered) still goes to the match, which slots it in
    // if it helps the blend.
    if (snap.tick > this.snapshotTick) {
      const at = performance.now();
      if (this.previousSnapshot) {
        const variation = Math.abs((at - this.previousSnapshot.at) - (snap.tick - this.previousSnapshot.tick) * CONFIG.tick * 1000);
        this.jitterMs += (variation - this.jitterMs) / 16;
      }
      this.previousSnapshot = { tick: snap.tick, at };
      this.lastSnapshotAt = at;
      this.snapshotTick = snap.tick;
    }
    this.emit('snap', snap);
  }

  private markLinked() {
    const ready = this.courierLinked && !!this.room && (!this.room.matchId || this.syncedMatchId === this.room.matchId);
    if (ready && !this.linked) this.set({ linked: true });
  }

  private receive(msg: ToClient) {
    switch (msg.t) {
      case 'room':
        if (msg.room?.version !== PROTOCOL_VERSION) return this.fail(VERSION_MESSAGE);
        if (msg.room.matchId !== this.room?.matchId) {
          this.syncedMatchId = null;
          this.previousSnapshot = null;
          this.lastSnapshotAt = performance.now();
          this.snapshotTick = this.hostTick = -1;
        }
        this.set({ room: msg.room, status: 'room' });
        location.hash = `#/join/${this.code}`;
        break;
      case 'sync':
        if (msg.sync.snap.matchId !== this.room?.matchId) return;
        this.syncedMatchId = msg.sync.snap.matchId;
        this.snapshotTick = this.eventTick = this.baselineTick = msg.sync.snap.tick;
        this.lastSnapshotAt = performance.now();
        this.previousSnapshot = { tick: msg.sync.snap.tick, at: this.lastSnapshotAt };
        this.emit('sync', msg.sync);
        break;
      case 'events':
        if (msg.matchId !== this.syncedMatchId || msg.matchId !== this.room?.matchId || msg.tick <= this.eventTick) return;
        this.eventTick = msg.tick;
        this.emit('events', msg.tick, msg.events);
        break;
      case 'rejected':
        this.fail(msg.reason);
        store.set(sessionStorage, KEYS.joined, null);
        break;
    }
  }

  /** A guest's input for this tick. */
  sendInput(input: Input) {
    if (!this.room?.matchId || this.syncedMatchId !== this.room.matchId) return;
    this.recentInputs.push({ ...input, seq: ++this.seq });
    if (this.recentInputs.length > CONFIG.net.inputRepeat) this.recentInputs.shift();
    this.guest?.sendState({ t: 'input', matchId: this.room.matchId, inputs: [...this.recentInputs] });
  }

  // Shared ----------------------------------------------------------------

  /** Back to the menu. A host leaving closes the room for everyone. */
  leave() {
    store.set(sessionStorage, KEYS.host, null);
    store.set(sessionStorage, KEYS.joined, null);
    this.teardown();
    this.set({ status: 'home' });
    location.hash = '#/';
  }

  private teardown() {
    clearInterval(this.stallCheck);
    this.stallCheck = undefined;
    // Detach first: closing fires callbacks that must find nothing to change.
    const { hosting, guest } = this;
    this.hosting = null;
    this.guest = null;
    this.host = null;
    hosting?.close();
    guest?.close();
    this.links.clear();
    this.room = null;
    this.role = null;
    this.linked = true;
    this.seq = 0;
    this.recentInputs = [];
    this.freshAttempt();
    this.pings = {};
  }

  private fail(message: string) {
    this.teardown();
    this.set({ status: 'error', message });
  }

  /** Called once on page load: carry on hosting, rejoin or play solo after a refresh. */
  restore() {
    const [, kind, raw] = location.hash.split('/');
    const code = (raw ?? '').toUpperCase();
    if (kind === 'solo') this.playSolo();
    else if (kind === 'train') this.train();
    else if (kind === 'host' && code && store.get(sessionStorage, KEYS.host) === code) this.hostRoom(code);
    else if (kind === 'join' && code && store.get(sessionStorage, KEYS.joined) === code) this.joinRoom(code);
  }

  /** A join link opened fresh: the code to offer on the home screen. */
  invitedTo(): string | null {
    const [, kind, raw] = location.hash.split('/');
    return kind === 'join' && raw ? raw.toUpperCase() : null;
  }
}

export const session = new Session();
