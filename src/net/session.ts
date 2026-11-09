import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { CONFIG } from '../config';
import type { Input, Rules, SimEvent, Team } from '../engine/sim';
import { loadKeepers, loadRules, saveKeepers, saveRules } from '../game/rules';
import { iceServers } from './relay';
import {
  cleanInput, cleanName, newRoomCode, PEER_PREFIX, PROTOCOL_VERSION, VERSION_MESSAGE, validTeam,
  type MatchSync, type RoomView, type Snapshot, type ToClient, type ToHost,
} from './protocol';
import { HostRoom, type Link } from './room';
import { loadAttributes, type Attributes } from '../game/attributes';
import { KEYS, store } from '../storage';

// The connection side: one browser hosts the
// room over PeerJS, the others join by code. Each guest opens two
// connections to the host (see protocol.ts). Screens listen for changes.

export type Status = 'home' | 'connecting' | 'room' | 'solo' | 'training' | 'error';

export interface SessionListener {
  change?(): void;
  snap?(snap: Snapshot): void;
  sync?(sync: MatchSync): void;
  events?(tick: number, events: SimEvent[]): void;
}

/** Per-tab identity, so a refresh reclaims the same player but two tabs are two players. */
function tabId(): string {
  let id = store.get(sessionStorage, KEYS.id);
  if (!id) {
    id = crypto.randomUUID();
    store.set(sessionStorage, KEYS.id, id);
  }
  return id;
}

/** How long a guest waits for the direct connection before giving up. */
const JOIN_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 1000;
const SILENCE_MS = 8000;
const RETRY_MS = 2500;
// Stop feeding obsolete inputs/snapshots into a congested browser queue.
const STATE_BUFFER_BYTES = 16 * 1024;

function send(conn: DataConnection | null | undefined, msg: ToHost | ToClient, realtime = false) {
  if (!conn?.open) return;
  if (realtime && conn.dataChannel.bufferedAmount > STATE_BUFFER_BYTES) return;
  try {
    conn.send(msg);
  } catch (error) {
    console.warn('[ink-kick] send failed', conn.label, error);
    conn.close();
  }
}

// Relay servers when the turn-relay Worker answers, else PeerJS's defaults.
async function peerOptions(): Promise<PeerOptions> {
  const servers = await iceServers();
  return servers ? { config: { iceServers: servers } } : {};
}

// The room a tab was hosting, so a refresh reopens it under the same code.

export class Session {
  status: Status = 'home';
  message = '';
  role: 'host' | 'client' | null = null;
  code = '';
  me = tabId();
  room: RoomView | null = null;
  /** False while a guest is reconnecting to the host. */
  linked = true;
  name = store.get(localStorage, KEYS.name) ?? '';
  host: HostRoom | null = null;

  private listeners = new Set<SessionListener>();
  private peer: Peer | null = null;
  private control: DataConnection | null = null;
  private state: DataConnection | null = null;
  private seq = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private monitor: ReturnType<typeof setInterval> | undefined;
  /** Bumped on teardown, so a peer still being set up knows it's stale. */
  private gen = 0;

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
    this.host = new HostRoom(code, this.me, this.name || 'Host', { change: room => this.set({ room }) }, loadAttributes());
    this.host.setRules(loadRules());
    this.host.setKeepers(loadKeepers());
    store.set(sessionStorage, KEYS.host, code);
    this.set({ status: 'connecting', message: resumeCode ? 'Reopening your room…' : 'Creating room…', room: this.host.view() });
    void this.openHostPeer(code, !resumeCode, 0);
  }

  private async openHostPeer(code: string, fresh: boolean, attempt: number) {
    const gen = this.gen;
    const options = await peerOptions();
    if (gen !== this.gen) return; // left or restarted while waiting
    const peer = new Peer(PEER_PREFIX + code, options);
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.set({ status: 'room' });
      location.hash = `#/host/${code}`;
    });
    peer.on('connection', conn => {
      if (this.peer === peer) this.acceptGuest(conn);
      else conn.close();
    });
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', err => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id') {
        peer.destroy();
        // Code collision on a brand new room: just pick another.
        if (fresh) return this.hostRoom();
        // The broker still remembers our old connection; it frees up shortly.
        if (attempt < 20) {
          this.set({ message: 'Reclaiming your room code…' });
          this.retry = setTimeout(() => this.openHostPeer(code, false, attempt + 1), 3000);
          return;
        }
      }
      if (this.status === 'room' && (err.type === 'network' || err.type === 'server-error')) return;
      if (this.status !== 'room') this.fail(`Could not open the room (${err.type}).`);
    });
  }

  // A guest's control connection says who they are; their state connection
  // carries that id in its metadata.
  private states = new Map<string, DataConnection>();
  private controls = new Map<string, DataConnection>();

  private acceptGuest(conn: DataConnection) {
    const host = this.host!;
    if (conn.label === 'state') {
      const metadata = conn.metadata as { id?: unknown; controlId?: unknown } | undefined;
      const id = typeof metadata?.id === 'string' ? metadata.id : '';
      const paired = () => {
        const control = this.controls.get(id);
        return control?.peer === conn.peer && control.connectionId === metadata?.controlId;
      };
      if (!id) return conn.close();
      conn.on('open', () => {
        if (this.host !== host) return conn.close();
        // State channels from a replaced connection cannot steal the stream.
        if (!paired()) return conn.close();
        const old = this.states.get(id);
        this.states.set(id, conn);
        old?.close();
      });
      conn.on('data', d => {
        if (this.host !== host || this.states.get(id) !== conn || !paired()) return;
        const msg = d as ToHost;
        if (msg?.t === 'ping') return send(conn, { t: 'pong', tick: host.tick, matchId: host.matchId, sentAt: msg.sentAt }, true);
        if (msg?.t !== 'input' || msg.matchId !== host.matchId) return;
        const input = cleanInput(msg.input);
        if (input) host.input(id, input);
      });
      const closed = () => {
        if (this.states.get(id) !== conn) return;
        this.states.delete(id);
        if (paired()) this.controls.get(id)?.close();
        if (conn.open) conn.close();
      };
      conn.on('close', closed);
      conn.on('error', closed);
      return;
    }
    if (conn.label !== 'control') return conn.close();
    let id: string | null = null;
    const link: Link = {
      send: m => send(conn, m),
      sendState: m => {
        const state = id && this.controls.get(id) === conn ? this.states.get(id) : undefined;
        send(state, m, true);
      },
    };
    conn.on('data', d => {
      if (this.host !== host) return;
      const msg = d as ToHost;
      if (msg?.t === 'hello' && !id && typeof msg.id === 'string' && msg.id && msg.id !== this.me) {
        if (msg.version !== PROTOCOL_VERSION) {
          send(conn, { t: 'rejected', reason: VERSION_MESSAGE });
          conn.close({ flush: true });
          return;
        }
        id = msg.id;
        const oldControl = this.controls.get(id);
        const oldState = this.states.get(id);
        this.controls.set(id, conn);
        this.states.delete(id);
        host.join(id, cleanName(msg.name), link, msg.attrs);
        oldState?.close();
        oldControl?.close();
      } else if (id && this.controls.get(id) !== conn) {
        return;
      } else if (msg?.t === 'ping' && id) {
        send(conn, { t: 'pong', tick: host.tick, matchId: host.matchId, sentAt: msg.sentAt });
      } else if (msg?.t === 'team' && id && validTeam(msg.team)) {
        host.setTeam(id, msg.team);
      } else if (msg?.t === 'attrs' && id) {
        host.setAttributes(id, msg.attrs);
      }
    });
    const closed = () => {
      if (!id || this.controls.get(id) !== conn) return;
      this.controls.delete(id);
      const state = this.states.get(id);
      this.states.delete(id);
      state?.close();
      host.disconnect(id, link);
      if (conn.open) conn.close();
    };
    conn.on('close', closed);
    conn.on('error', closed);
  }

  setTeam(team: Team) {
    if (this.host) this.host.setTeam(this.me, team);
    else this.sendControl({ t: 'team', team });
  }

  /** Attributes changed in the lobby, for the next kickoff. */
  setAttributes(attrs: Attributes) {
    if (this.status !== 'room') return;
    if (this.host) this.host.setAttributes(this.me, attrs);
    else this.sendControl({ t: 'attrs', attrs });
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

  joinRoom(code: string) {
    this.teardown();
    this.role = 'client';
    this.code = code;
    this.set({ status: 'connecting', message: `Looking for room ${code}…`, linked: false });
    store.set(sessionStorage, KEYS.joined, code);
    void this.openGuestPeer(code);
  }

  private async openGuestPeer(code: string) {
    const gen = this.gen;
    const options = await peerOptions();
    if (gen !== this.gen) return;
    const peer = new Peer(options);
    this.peer = peer;
    this.watchGuest(peer);
    peer.on('open', () => {
      if (this.peer === peer && !this.control) this.connectToHost();
    });
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', err => {
      if (this.peer !== peer) return;
      // Signaling can reconnect while established WebRTC transports carry on.
      if ((err.type === 'network' || err.type === 'server-error') && this.control?.open && this.state?.open) return;
      if (this.room) return this.scheduleReconnect(`peer-${err.type}`);
      if (err.type === 'peer-unavailable') {
        return this.fail(`Couldn't find room ${code}. Check the code, and that the host still has the page open.`);
      }
      this.fail(`Connection failed (${err.type}).`);
    });
  }

  private lastControlAt = 0;
  private lastStateAt = 0;
  private lastSnapshotAt = 0;
  private snapshotTick = -1;
  private hostTick = -1;
  private stateReady = false;
  private syncedMatchId: string | null = null;
  private eventTick = -1;
  private reconnectCount = 0;
  private reconnectReason: string | null = null;
  private rtt = { control: null as number | null, state: null as number | null };
  private jitterMs = 0;
  private previousSnapshot: { tick: number; at: number } | null = null;

  /** Safe to share: no candidate addresses or relay credentials. */
  async diagnostics() {
    const route = async (conn: DataConnection | null) => {
      if (!conn?.peerConnection?.getStats) return 'unknown';
      try {
        const stats = await conn.peerConnection.getStats();
        let selected: RTCStats | undefined;
        stats.forEach(s => {
          if (s.type === 'transport' && s.selectedCandidatePairId) selected = stats.get(s.selectedCandidatePairId);
        });
        if (!selected) stats.forEach(s => {
          if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') selected = s;
        });
        if (!selected) return 'unknown';
        const pair = selected as RTCStats & { localCandidateId: string; remoteCandidateId: string };
        return [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)]
          .some(c => c?.candidateType === 'relay') ? 'relay' : 'direct';
      } catch { return 'unknown'; }
    };
    const [controlRoute, stateRoute] = await Promise.all([route(this.control), route(this.state)]);
    return {
      linked: this.linked, matchId: this.room?.matchId ?? null,
      reconnectCount: this.reconnectCount, reconnectReason: this.reconnectReason,
      snapshotAgeMs: this.previousSnapshot ? performance.now() - this.lastSnapshotAt : null,
      snapshotJitterMs: this.jitterMs,
      control: { rttMs: this.rtt.control, bufferedBytes: this.control?.dataChannel?.bufferedAmount ?? 0, route: controlRoute },
      state: { rttMs: this.rtt.state, bufferedBytes: this.state?.dataChannel?.bufferedAmount ?? 0, route: stateRoute },
    };
  }

  private pong(msg: Extract<ToClient, { t: 'pong' }>, channel: 'control' | 'state') {
    const age = performance.now() - msg.sentAt;
    if (!Number.isFinite(age) || age < 0 || age >= SILENCE_MS || !Number.isSafeInteger(msg.tick) || msg.tick < 0) return false;
    this.rtt[channel] = age;
    if (msg.matchId === this.room?.matchId) this.hostTick = Math.max(this.hostTick, msg.tick);
    return true;
  }

  private snapshot(snap: Snapshot) {
    if (!snap || !Number.isSafeInteger(snap.tick) || snap.tick < 0) return;
    if (snap.matchId !== this.room?.matchId || snap.matchId !== this.syncedMatchId || snap.tick <= this.snapshotTick) return;
    const at = performance.now();
    if (this.previousSnapshot) {
      const variation = Math.abs((at - this.previousSnapshot.at) - (snap.tick - this.previousSnapshot.tick) * CONFIG.tick * 1000);
      this.jitterMs += (variation - this.jitterMs) / 16;
    }
    this.previousSnapshot = { tick: snap.tick, at };
    this.lastSnapshotAt = at;
    this.snapshotTick = snap.tick;
    this.emit('snap', snap);
  }

  // Watch application traffic, not just WebRTC's open flag. A transport
  // can silently stop delivering while its sibling connection stays open.
  private watchGuest(peer: Peer) {
    clearInterval(this.monitor);
    const started = performance.now();
    this.lastControlAt = this.lastStateAt = this.lastSnapshotAt = started;
    this.snapshotTick = this.hostTick = -1;
    this.stateReady = false;
    this.syncedMatchId = null;
    this.previousSnapshot = null;
    this.jitterMs = 0;
    this.rtt = { control: null, state: null };
    this.monitor = setInterval(() => {
      if (this.peer !== peer) return;
      const now = performance.now();
      if (!this.control?.open || !this.state?.open || !this.room) {
        if (now - started < JOIN_TIMEOUT_MS) return;
        if (this.room) this.scheduleReconnect('connection-timeout');
        else this.fail(`Found room ${this.code} but couldn't connect to it. Check your connection and try another browser if WebRTC is blocked.`);
        return;
      }
      if (now - this.lastControlAt >= SILENCE_MS) return this.scheduleReconnect('control-timeout');
      if (now - this.lastStateAt >= SILENCE_MS) return this.scheduleReconnect('state-timeout');
      // A backgrounded host may stop simulating, but still answer pings.
      // Only call snapshots stalled when its simulation is advancing.
      if (this.room.phase === 'match' && this.hostTick > this.snapshotTick && now - this.lastSnapshotAt >= SILENCE_MS) {
        return this.scheduleReconnect('snapshot-timeout');
      }
      send(this.control, { t: 'ping', sentAt: performance.now() });
      send(this.state, { t: 'ping', sentAt: performance.now() }, true);
    }, HEARTBEAT_MS);
  }

  private markLinked() {
    if (!this.linked && this.room && (!this.room.matchId || this.syncedMatchId === this.room.matchId) && this.control?.open && this.state?.open && this.stateReady) this.set({ linked: true });
  }

  private connectToHost() {
    if (!this.peer || this.peer.destroyed) return;
    const target = PEER_PREFIX + this.code;
    const conn = this.peer.connect(target, { label: 'control', reliable: true, serialization: 'json' });
    this.control = conn;
    const current = () => this.control === conn;
    this.watchConnection(conn, () => {
      if (current()) this.scheduleReconnect('control-closed');
    });
    conn.on('open', () => {
      if (!current()) return;
      this.lastControlAt = performance.now();
      this.sendControl({ t: 'hello', version: PROTOCOL_VERSION, id: this.me, name: this.name || 'Player', attrs: loadAttributes() });
    });
    conn.on('data', d => {
      if (!current()) return;
      const msg = d as ToClient;
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'room') this.lastControlAt = performance.now();
      if (msg.t === 'pong' && !this.pong(msg, 'control')) return;
      this.receive(msg);
      // Wait for the hello acknowledgement before opening state, so the
      // host can bind both connections to the same player and attempt.
      if (msg.t === 'room' && current() && !this.state) {
        const state = this.peer!.connect(target, {
          label: 'state', reliable: false, serialization: 'json',
          metadata: { id: this.me, controlId: conn.connectionId },
        });
        this.state = state;
        this.lastStateAt = this.lastSnapshotAt = performance.now();
        this.watchConnection(state, () => {
          if (this.state === state) this.scheduleReconnect('state-closed');
        });
        state.on('open', () => {
          if (this.state !== state) return;
          this.lastStateAt = this.lastSnapshotAt = performance.now();
          send(state, { t: 'ping', sentAt: performance.now() }, true);
        });
        state.on('data', d => {
          if (this.state !== state) return;
          const msg = d as ToClient;
          if (msg?.t === 'pong') {
            if (!this.pong(msg, 'state')) return;
            this.lastStateAt = performance.now();
          } else if (msg?.t === 'snap') {
            this.snapshot(msg.snap);
          } else return;
          this.stateReady = true;
          this.markLinked();
        });
      }
      this.markLinked();
    });
  }

  private watchConnection(conn: DataConnection, lost: () => void) {
    conn.on('close', lost);
    conn.on('error', lost);
    conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
      const state = conn.peerConnection?.iceConnectionState;
      console.info('[ink-kick] connection', conn.label, state);
      // Give a transient disconnection time to recover; failed is final.
      if (state === 'failed') lost();
    });
  }

  private scheduleReconnect(reason: string) {
    if (this.role !== 'client' || this.retry !== undefined) return;
    this.reconnectCount++;
    this.reconnectReason = reason;
    console.warn('[ink-kick] reconnecting', {
      reason, snapshotTick: this.snapshotTick, hostTick: this.hostTick,
      controlSilenceMs: performance.now() - this.lastControlAt,
      stateSilenceMs: performance.now() - this.lastStateAt,
    });
    clearInterval(this.monitor);
    // Detach before closing: late callbacks must not affect the new pair.
    this.gen++;
    const peer = this.peer;
    this.peer = null;
    this.control = this.state = null;
    peer?.destroy();
    this.set({ linked: false });
    // A fresh Peer also rebuilds ICE and refreshes relay credentials.
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.openGuestPeer(this.code);
    }, RETRY_MS);
  }

  private receive(msg: ToClient) {
    switch (msg.t) {
      case 'pong':
        this.lastControlAt = performance.now();
        break;
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
        this.snapshotTick = this.eventTick = msg.sync.snap.tick;
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

  private sendControl(msg: ToHost) {
    send(this.control, msg);
  }

  /** A guest's input for this tick. */
  sendInput(input: Input) {
    if (!this.room?.matchId || this.syncedMatchId !== this.room.matchId) return;
    send(this.state, { t: 'input', matchId: this.room.matchId, input: { ...input, seq: ++this.seq } }, true);
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
    this.gen++;
    clearTimeout(this.retry);
    this.retry = undefined;
    clearInterval(this.monitor);
    this.host = null;
    this.control = null;
    this.state = null;
    this.states.clear();
    this.controls.clear();
    this.peer?.destroy();
    this.peer = null;
    this.room = null;
    this.role = null;
    this.linked = true;
    this.seq = 0;
    this.syncedMatchId = null;
    this.previousSnapshot = null;
    this.reconnectCount = 0;
    this.reconnectReason = null;
    this.jitterMs = 0;
    this.rtt = { control: null, state: null };
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
