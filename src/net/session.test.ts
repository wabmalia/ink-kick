import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView, Snapshot } from './protocol';

// Exercise the real session state machine, replacing only the browser and
// PeerJS transports. Events can be lost, delayed or delivered after close.
const transport = vi.hoisted(() => {
  class Events {
    handlers = new Map<string, ((...args: any[]) => void)[]>();
    on(event: string, fn: (...args: any[]) => void) {
      this.handlers.set(event, [...this.handlers.get(event) ?? [], fn]);
    }
    emit(event: string, ...args: any[]) {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
    }
  }
  let serial = 0;
  class Connection extends Events {
    open = false;
    connectionId = `connection-${++serial}`;
    sent: unknown[] = [];
    dataChannel = { bufferedAmount: 0 };
    peerConnection = Object.assign(new EventTarget(), { iceConnectionState: 'connected' });
    constructor(public peer: string, public label: string, public metadata?: unknown) { super(); }
    send(msg: unknown) { this.sent.push(msg); }
    close() {
      this.open = false;
      this.emit('close');
    }
    ready() { this.open = true; this.emit('open'); }
  }
  const peers: Peer[] = [];
  class Peer extends Events {
    destroyed = false;
    connections: Connection[] = [];
    constructor(..._args: unknown[]) { super(); peers.push(this); }
    connect(peer: string, options: { label: string; metadata?: unknown }) {
      const conn = new Connection(peer, options.label, options.metadata);
      this.connections.push(conn);
      return conn;
    }
    reconnect = vi.fn();
    destroy() {
      this.destroyed = true;
      for (const conn of this.connections) conn.close();
    }
  }
  return { Peer, Connection, peers };
});
vi.mock('peerjs', () => ({ Peer: transport.Peer }));
vi.mock('./relay', () => ({ iceServers: vi.fn(async () => undefined) }));

let session: import('./session').Session;
const room: RoomView = {
  code: 'ABCDE', hostId: 'host', phase: 'match',
  members: [{ id: 'host', name: 'Host', team: 'gold', connected: true }],
  rules: { kind: 'first', goals: 3 }, keepers: false,
};
const snap = (tick: number): Snapshot => ({ tick, ball: [0, 0], owner: null, score: [0, 0], clock: 0, players: [] });
const idle = { x: 0, y: 0, kick: false, sprint: false };
const latestPeer = () => transport.peers[transport.peers.length - 1]!;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('location', { hash: '' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  transport.peers.length = 0;
  const { Session } = await import('./session');
  session = new Session();
});
afterEach(() => {
  session.leave();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function join() {
  session.joinRoom('ABCDE');
  await flush();
  return handshake();
}
function handshake() {
  const peer = latestPeer();
  peer.emit('open');
  const control = peer.connections[0]!;
  control.ready();
  // State is opened only after the host has acknowledged our identity.
  expect(peer.connections).toHaveLength(1);
  control.emit('data', { t: 'room', room });
  const state = peer.connections[1]!;
  expect(state.metadata).toEqual({ id: session.me, controlId: control.connectionId });
  state.ready();
  state.emit('data', { t: 'pong', tick: 0 });
  return { peer, control, state };
}
function keepAlive(control: InstanceType<typeof transport.Connection>, state?: InstanceType<typeof transport.Connection>, tick = 0) {
  control.emit('data', { t: 'pong', tick });
  state?.emit('data', { t: 'pong', tick });
}

describe('guest connection recovery', () => {
  it('recovers a silent state connection while control stays open, retaining the player and room', async () => {
    const { peer, control, state } = await join();
    const me = session.me;
    const received = vi.fn();
    session.listen({ snap: received });
    state.emit('data', { t: 'snap', snap: snap(1) });
    for (let i = 0; i < 8; i++) {
      keepAlive(control);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(peer.destroyed).toBe(true);
    expect(session.linked).toBe(false);
    expect(session.room).toEqual(room);
    expect(session.status).toBe('room');
    await vi.advanceTimersByTimeAsync(2500);
    expect(transport.peers).toHaveLength(2);
    const next = handshake();
    next.state.emit('data', { t: 'snap', snap: snap(700) });
    expect(session.linked).toBe(true);
    expect(session.me).toBe(me);
    expect(received).toHaveBeenLastCalledWith(snap(700));
    // The retired transport must never inject stale snapshots or errors.
    state.emit('data', { t: 'snap', snap: snap(2) });
    state.emit('error', new Error('late'));
    control.emit('data', { t: 'room', room: { ...room, phase: 'lobby' } });
    expect(received).toHaveBeenCalledTimes(2);
    expect(session.room?.phase).toBe('match');
    expect(session.linked).toBe(true);
  });

  it.each(['close', 'error', 'ice-failed'])('recovers on a state %s without waiting for control to close', async event => {
    const { peer, state } = await join();
    if (event === 'ice-failed') {
      state.peerConnection.iceConnectionState = 'failed';
      state.peerConnection.dispatchEvent(new Event('iceconnectionstatechange'));
    } else state.emit(event, new Error('lost'));
    expect(session.linked).toBe(false);
    expect(peer.destroyed).toBe(true);
    // Duplicate notifications schedule only one replacement.
    state.emit('close');
    await vi.advanceTimersByTimeAsync(2500);
    expect(transport.peers).toHaveLength(2);
  });

  it('detects lost upstream state traffic even if snapshots still arrive', async () => {
    const { peer, control, state } = await join();
    for (let i = 0; i < 8; i++) {
      keepAlive(control, undefined, i * 60);
      state.emit('data', { t: 'snap', snap: snap(i * 60) });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(peer.destroyed).toBe(true);
    expect(session.linked).toBe(false);
  });

  it('detects missing snapshots even when both channels answer pings', async () => {
    const { peer, control, state } = await join();
    for (let i = 0; i < 8; i++) {
      keepAlive(control, state, (i + 1) * 60);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(peer.destroyed).toBe(true);
  });

  it('allows a paused host to answer pings without advancing the match', async () => {
    const { peer, control, state } = await join();
    state.emit('data', { t: 'snap', snap: snap(100) });
    for (let i = 0; i < 20; i++) {
      keepAlive(control, state, 100);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(peer.destroyed).toBe(false);
    expect(session.linked).toBe(true);
    expect(control.sent).toContainEqual({ t: 'ping' });
    expect(state.sent).toContainEqual({ t: 'ping' });
  });

  it('gives a match started after a long lobby time to receive its first snapshot', async () => {
    const { peer, control, state } = await join();
    control.emit('data', { t: 'room', room: { ...room, phase: 'lobby' } });
    for (let i = 0; i < 20; i++) {
      keepAlive(control, state, 0);
      await vi.advanceTimersByTimeAsync(1000);
    }
    control.emit('data', { t: 'room', room });
    keepAlive(control, state, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.destroyed).toBe(false);
    state.emit('data', { t: 'snap', snap: snap(3) });
    expect(session.linked).toBe(true);
  });

  it('does not mistake one-way control events for heartbeat acknowledgements', async () => {
    const { peer, control, state } = await join();
    state.emit('data', { t: 'snap', snap: snap(0) });
    for (let i = 0; i < 8; i++) {
      state.emit('data', { t: 'pong', tick: 0 });
      control.emit('data', { t: 'events', tick: 0, events: [] });
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(peer.destroyed).toBe(true);
  });

  it('retries a replacement that never opens instead of hanging forever', async () => {
    const { state } = await join();
    state.close();
    await vi.advanceTimersByTimeAsync(2500);
    const replacement = latestPeer();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(replacement.destroyed).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(transport.peers).toHaveLength(3);
  });

  it('times out an initial connection whose state channel never opens', async () => {
    session.joinRoom('ABCDE');
    await flush();
    const peer = latestPeer();
    peer.emit('open');
    peer.connections[0]!.ready();
    peer.connections[0]!.emit('data', { t: 'room', room });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(peer.destroyed).toBe(true);
    expect(session.linked).toBe(false);
  });

  it('drops inputs under backpressure and resumes with a newer sequence', async () => {
    const { state } = await join();
    state.sent.length = 0;
    session.sendInput(idle);
    state.dataChannel.bufferedAmount = 32 * 1024;
    for (let i = 0; i < 100; i++) session.sendInput(idle);
    expect(state.sent).toHaveLength(1);
    state.dataChannel.bufferedAmount = 0;
    session.sendInput({ ...idle, x: 1 });
    expect(state.sent[1]).toMatchObject({ t: 'input', input: { x: 1, seq: 102 } });
  });

  it('cancels pending recovery on leaving the room', async () => {
    const { state } = await join();
    state.close();
    session.leave();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.peers).toHaveLength(1);
    expect(session.status).toBe('home');
  });
});

describe('host transport isolation', () => {
  async function host() {
    session.hostRoom('ABCDE');
    await flush();
    const peer = latestPeer();
    peer.emit('open');
    return peer;
  }
  function guest(peer: InstanceType<typeof transport.Peer>, guestPeer = 'guest-peer', id = 'guest') {
    const control = new transport.Connection(guestPeer, 'control');
    peer.emit('connection', control);
    control.ready();
    control.emit('data', { t: 'hello', id, name: 'Guest' });
    const state = new transport.Connection(guestPeer, 'state', { id, controlId: control.connectionId });
    peer.emit('connection', state);
    state.ready();
    return { control, state };
  }

  it('answers heartbeats on each channel and isolates a returning player from stale traffic', async () => {
    const peer = await host();
    const first = guest(peer);
    session.start();
    const next = guest(peer, 'replacement-peer');
    first.control.emit('close');
    first.state.emit('open');
    expect(session.room!.members.find(m => m.id === 'guest')!.connected).toBe(true);
    expect(session.host!.match!.players.filter(p => p.id === 'guest')).toHaveLength(1);
    first.state.emit('data', { t: 'input', input: { ...idle, seq: 9999, y: -1 } });
    next.state.emit('data', { t: 'input', input: { ...idle, seq: 1, y: 1 } });
    session.host!.match!.holdFor = 0;
    for (let i = 0; i < 10; i++) session.host!.step(idle);
    expect(session.host!.match!.players.find(p => p.id === 'guest')!.vy).toBeGreaterThan(0);
    for (const conn of [next.control, next.state]) {
      conn.emit('data', { t: 'ping' });
      expect(conn.sent).toContainEqual({ t: 'pong', tick: 10 });
    }
    const count = next.state.sent.length;
    next.state.dataChannel.bufferedAmount = 32 * 1024;
    for (let i = 0; i < 10; i++) session.host!.step(idle);
    expect(next.state.sent).toHaveLength(count);
    next.state.dataChannel.bufferedAmount = 0;
    for (let i = 0; i < 10; i++) session.host!.step(idle);
    expect(next.state.sent.length).toBeGreaterThan(count);
  });

  it('keeps the other guest receiving snapshots when one connection fails', async () => {
    const peer = await host();
    const first = guest(peer);
    const other = guest(peer, 'other-peer', 'other');
    session.start();
    first.state.close();
    for (let i = 0; i < 12; i++) session.host!.step(idle);
    expect(other.control.open).toBe(true);
    expect(other.state.sent.some(m => (m as { t: string }).t === 'snap')).toBe(true);
    expect(session.host!.match!.players).toHaveLength(3);
    const returning = guest(peer, 'returning-peer');
    for (let i = 0; i < 12; i++) session.host!.step(idle);
    expect(returning.state.sent.some(m => (m as { t: string }).t === 'snap')).toBe(true);
    expect(session.host!.match!.players).toHaveLength(3);
  });

  it('marks a guest disconnected if their state connection closes', async () => {
    const peer = await host();
    const { state } = guest(peer);
    state.close();
    expect(session.room!.members.find(m => m.id === 'guest')!.connected).toBe(false);
  });

  it('keeps a guest send failure from stopping the host simulation', async () => {
    const peer = await host();
    const { state } = guest(peer);
    session.start();
    vi.spyOn(state, 'send').mockImplementation(() => { throw new Error('transport failed'); });
    expect(() => { for (let i = 0; i < 10; i++) session.host!.step(idle); }).not.toThrow();
    expect(session.host!.tick).toBe(10);
    expect(session.room!.members.find(m => m.id === 'guest')!.connected).toBe(false);
  });
});
