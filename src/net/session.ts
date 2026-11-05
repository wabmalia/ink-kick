import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import type { Input, Rules, SimEvent, Team } from '../engine/sim';
import { loadKeepers, loadRules, saveKeepers, saveRules } from '../game/rules';
import { iceServers } from './relay';
import {
  cleanInput, cleanName, newRoomCode, PEER_PREFIX, validTeam,
  type RoomView, type Snapshot, type ToClient, type ToHost,
} from './protocol';
import { HostRoom, type Link } from './room';
import { loadAttributes } from '../game/attributes';

// The connection side, the same shape as sinkhole's: one browser hosts the
// room over PeerJS, the others join by code. Each guest opens two
// connections to the host (see protocol.ts). Screens listen for changes.

export type Status = 'home' | 'connecting' | 'room' | 'solo' | 'training' | 'error';

export interface SessionListener {
  change?(): void;
  snap?(snap: Snapshot): void;
  events?(tick: number, events: SimEvent[]): void;
}

// Storage can throw (private mode, blocked site data); none of it is essential.
const store = {
  get(area: Storage, key: string): string | null {
    try {
      return area.getItem(key);
    } catch {
      return null;
    }
  },
  set(area: Storage, key: string, value: string | null) {
    try {
      if (value === null) area.removeItem(key);
      else area.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

/** Per-tab identity, so a refresh reclaims the same player but two tabs are two players. */
function tabId(): string {
  let id = store.get(sessionStorage, 'inkkick.id');
  if (!id) {
    id = crypto.randomUUID();
    store.set(sessionStorage, 'inkkick.id', id);
  }
  return id;
}

/** How long a guest waits for the direct connection before giving up. */
const JOIN_TIMEOUT_MS = 15_000;

// Relay servers when the turn-relay Worker answers, else PeerJS's defaults.
async function peerOptions(): Promise<PeerOptions> {
  const servers = await iceServers();
  return servers ? { config: { iceServers: servers } } : {};
}

// The room a tab was hosting, so a refresh reopens it under the same code.
const HOST_KEY = 'inkkick.host';

class Session {
  status: Status = 'home';
  message = '';
  role: 'host' | 'client' | null = null;
  code = '';
  me = tabId();
  room: RoomView | null = null;
  /** False while a guest is reconnecting to the host. */
  linked = true;
  name = store.get(localStorage, 'inkkick.name') ?? '';
  host: HostRoom | null = null;

  private listeners = new Set<SessionListener>();
  private peer: Peer | null = null;
  private control: DataConnection | null = null;
  private state: DataConnection | null = null;
  private seq = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
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
    store.set(localStorage, 'inkkick.name', this.name);
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
    store.set(sessionStorage, HOST_KEY, code);
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
      this.set({ status: 'room' });
      location.hash = `#/host/${code}`;
    });
    peer.on('connection', conn => this.acceptGuest(conn));
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
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

  private acceptGuest(conn: DataConnection) {
    const host = this.host!;
    if (conn.label === 'state') {
      const id = String((conn.metadata as { id?: unknown } | undefined)?.id ?? '');
      if (!id) return conn.close();
      conn.on('open', () => this.states.set(id, conn));
      conn.on('data', d => {
        const msg = d as ToHost;
        if (msg?.t !== 'input') return;
        const input = cleanInput(msg.input);
        if (input) host.input(id, input);
      });
      conn.on('close', () => this.states.get(id) === conn && this.states.delete(id));
      return;
    }
    let id: string | null = null;
    const link: Link = {
      send: m => conn.open && conn.send(m),
      sendState: m => {
        const state = id ? this.states.get(id) : undefined;
        if (state?.open) state.send(m);
      },
    };
    conn.on('data', d => {
      const msg = d as ToHost;
      if (msg?.t === 'hello' && !id && typeof msg.id === 'string' && msg.id && msg.id !== this.me) {
        id = msg.id;
        host.join(id, cleanName(msg.name), link, msg.attrs);
      } else if (msg?.t === 'team' && id && validTeam(msg.team)) {
        host.setTeam(id, msg.team);
      }
    });
    const closed = () => id && host.disconnect(id, link);
    conn.on('close', closed);
    conn.on('error', closed);
  }

  setTeam(team: Team) {
    if (this.host) this.host.setTeam(this.me, team);
    else this.sendControl({ t: 'team', team });
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
    this.set({ status: 'connecting', message: `Looking for room ${code}…` });
    store.set(sessionStorage, 'inkkick.joined', code);
    void this.openGuestPeer(code);
  }

  private async openGuestPeer(code: string) {
    const gen = this.gen;
    const options = await peerOptions();
    if (gen !== this.gen) return;
    const peer = new Peer(options);
    this.peer = peer;
    peer.on('open', () => this.connectToHost());
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', err => {
      if (this.peer !== peer) return;
      if (err.type === 'peer-unavailable') {
        if (this.room) return this.scheduleReconnect();
        return this.fail(`Couldn't find room ${code}. Check the code, and that the host still has the page open.`);
      }
      if (this.room) return this.scheduleReconnect();
      this.fail(`Connection failed (${err.type}).`);
    });
  }

  private connectToHost() {
    if (!this.peer || this.peer.destroyed) return;
    const target = PEER_PREFIX + this.code;
    const conn = this.peer.connect(target, { label: 'control', reliable: true, serialization: 'json' });
    this.control = conn;
    // The room was found but the browsers can't reach each other directly.
    const stuck = () => {
      if (this.control !== conn || conn.open || this.room) return;
      this.fail(
        `Found room ${this.code} but couldn't connect to it. A browser privacy setting may be blocking WebRTC ` +
          `(Brave Shields, or WebRTC options in Firefox-based browsers). Try another browser or turn those off for this site.`,
      );
    };
    const timer = setTimeout(stuck, JOIN_TIMEOUT_MS);
    conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
      const state = conn.peerConnection?.iceConnectionState;
      console.info('[score] connection', state);
      if (state === 'failed') stuck();
    });
    conn.on('open', () => {
      clearTimeout(timer);
      this.set({ linked: true });
      this.sendControl({ t: 'hello', id: this.me, name: this.name || 'Player', attrs: loadAttributes() });
      // Unordered: a lost snapshot is replaced by the next one anyway.
      const state = this.peer!.connect(target, { label: 'state', reliable: false, serialization: 'json', metadata: { id: this.me } });
      this.state = state;
      state.on('data', d => {
        const msg = d as ToClient;
        if (msg?.t === 'snap') this.emit('snap', msg.snap);
      });
    });
    conn.on('data', d => this.receive(d as ToClient));
    conn.on('close', () => {
      if (this.control !== conn) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    this.state?.close();
    this.set({ linked: false });
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connectToHost(), 2500);
  }

  private receive(msg: ToClient) {
    switch (msg.t) {
      case 'room':
        this.set({ room: msg.room, status: 'room' });
        location.hash = `#/join/${this.code}`;
        break;
      case 'events':
        this.emit('events', msg.tick, msg.events);
        break;
      case 'rejected':
        this.fail(msg.reason);
        store.set(sessionStorage, 'inkkick.joined', null);
        break;
    }
  }

  private sendControl(msg: ToHost) {
    if (this.control?.open) this.control.send(msg);
  }

  /** A guest's input for this tick. */
  sendInput(input: Input) {
    if (this.state?.open) this.state.send({ t: 'input', input: { ...input, seq: ++this.seq } } satisfies ToHost);
  }

  // Shared ----------------------------------------------------------------

  /** Back to the menu. A host leaving closes the room for everyone. */
  leave() {
    store.set(sessionStorage, HOST_KEY, null);
    store.set(sessionStorage, 'inkkick.joined', null);
    this.teardown();
    this.set({ status: 'home' });
    location.hash = '#/';
  }

  private teardown() {
    this.gen++;
    clearTimeout(this.retry);
    this.host = null;
    this.control = null;
    this.state = null;
    this.states.clear();
    this.peer?.destroy();
    this.peer = null;
    this.room = null;
    this.role = null;
    this.linked = true;
    this.seq = 0;
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
    else if (kind === 'host' && code && store.get(sessionStorage, HOST_KEY) === code) this.hostRoom(code);
    else if (kind === 'join' && code && store.get(sessionStorage, 'inkkick.joined') === code) this.joinRoom(code);
  }

  /** A join link opened fresh: the code to offer on the home screen. */
  invitedTo(): string | null {
    const [, kind, raw] = location.hash.split('/');
    return kind === 'join' && raw ? raw.toUpperCase() : null;
  }
}

export const session = new Session();
