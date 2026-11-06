import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { RemoteMatch } from '../game/state';
import type { ToClient } from './protocol';
import { HostRoom, type Link } from './room';

const idle = { x: 0, y: 0, kick: false, sprint: false };

function link() {
  const sent: ToClient[] = [];
  const state: ToClient[] = [];
  const l: Link = { send: m => sent.push(m), sendState: m => state.push(m) };
  return { l, sent, state };
}

// Lets play start straight away, rather than after the coin toss.
function skipCoin(r: HostRoom) {
  r.match!.holdFor = 0;
}

function room() {
  return new HostRoom('ABCDE', 'host', 'Hosty', { change: () => {} });
}

describe('host room', () => {
  it('puts new guests on the smaller team and tells everyone', () => {
    const r = room();
    const a = link();
    r.join('a', 'Ana', a.l);
    r.join('b', 'Bo', link().l);
    expect(r.view().members.map(m => [m.id, m.team])).toEqual([['host', 'gold'], ['a', 'red'], ['b', 'gold']]);
    const last = a.sent[a.sent.length - 1];
    expect(last).toMatchObject({ t: 'room', room: { code: 'ABCDE', phase: 'lobby' } });
  });

  it('lets anyone switch team in the lobby, not during a match', () => {
    const r = room();
    r.join('a', 'Ana', link().l);
    r.setTeam('a', 'gold');
    expect(r.view().members[1]!.team).toBe('gold');
    r.start();
    r.setTeam('a', 'red');
    expect(r.view().members[1]!.team).toBe('gold');
  });

  it('keeps a returning guest in their place', () => {
    const r = room();
    const first = link();
    r.join('a', 'Ana', first.l);
    r.setTeam('a', 'gold');
    r.disconnect('a', first.l);
    expect(r.view().members[1]!.connected).toBe(false);
    r.join('a', 'Ana', link().l);
    expect(r.view().members[1]).toMatchObject({ team: 'gold', connected: true });
  });

  it('kicks off with everyone connected, and adds latecomers to the match', () => {
    const r = room();
    const gone = link();
    r.join('a', 'Ana', link().l);
    r.join('z', 'Zed', gone.l);
    r.disconnect('z', gone.l);
    r.start();
    expect(r.match!.players.map(p => p.id)).toEqual(['host', 'a']);
    r.join('b', 'Bo', link().l);
    expect(r.match!.players.map(p => p.id)).toEqual(['host', 'a', 'b']);
  });

  it('steers guests by their newest input', () => {
    const r = room();
    r.join('a', 'Ana', link().l);
    r.start();
    skipCoin(r);
    r.input('a', { seq: 2, ...idle, y: 1 });
    r.input('a', { seq: 1, ...idle, y: -1 });
    for (let i = 0; i < 30; i++) r.step(idle);
    expect(r.match!.players[1]!.vy).toBeGreaterThan(1);
  });

  it('sends snapshots and events that a guest can draw', () => {
    const r = room();
    const a = link();
    r.join('a', 'Ana', a.l);
    r.start();
    r.step(idle);
    skipCoin(r);
    // The host runs towards the far touchline, clear of everyone, for two seconds.
    for (let i = 0; i < 120; i++) r.step({ ...idle, y: -1 });
    const snaps = a.state.filter(m => m.t === 'snap');
    expect(snaps).toHaveLength(Math.floor(121 / CONFIG.net.snapshotEvery));
    expect(a.sent.some(m => m.t === 'events' && m.events.some(e => e.type === 'coin'))).toBe(true);

    const remote = new RemoteMatch();
    for (const m of snaps) if (m.t === 'snap') remote.push(m.snap);
    remote.advance(0);
    const drawn = remote.state()!;
    const host = drawn.players.find(p => p.id === 'host')!;
    // Drawn a little behind where the host really is.
    const actual = r.match!.players[0]!.y;
    expect(host.y).toBeGreaterThan(actual);
    expect(host.y).toBeLessThan(actual + 3);
  });

  it('uses attributes changed in the lobby, not once a match is on', () => {
    const r = room();
    const a = link();
    r.join('a', 'Ana', a.l, { pace: 5, stamina: 5, dribbling: 5, power: 5, tackling: 5, strength: 5 });
    r.setAttributes('a', { pace: 10, stamina: 5, dribbling: 5, power: 5, tackling: 4, strength: 1 });
    r.start();
    const ana = () => r.match!.players.find(p => p.id === 'a')!;
    expect(ana().stats.sprintSpeed).toBeCloseTo(CONFIG.player.sprintSpeed * 1.2);
    r.setAttributes('a', { pace: 1, stamina: 9, dribbling: 5, power: 5, tackling: 5, strength: 5 });
    // Kept for the rest of this match, and the next kickoff too.
    r.end();
    r.start();
    expect(ana().stats.sprintSpeed).toBeCloseTo(CONFIG.player.sprintSpeed * 1.2);
  });

  it('plays the match length the host picked, fixed once it kicks off', () => {
    const r = room();
    const a = link();
    r.join('a', 'Ana', a.l);
    r.setRules({ kind: 'timed', seconds: 180 });
    expect(r.view().rules).toEqual({ kind: 'timed', seconds: 180 });
    expect(a.sent[a.sent.length - 1]).toMatchObject({ t: 'room', room: { rules: { kind: 'timed', seconds: 180 } } });
    // Anything not on offer falls back to the default.
    r.setRules({ kind: 'first', goals: 99 });
    expect(r.view().rules).toEqual({ kind: 'first', goals: 3 });
    r.setRules({ kind: 'first', goals: 7 });
    r.start();
    expect(r.match!.rules).toEqual({ kind: 'first', goals: 7 });
    r.setRules({ kind: 'timed', seconds: 300 });
    expect(r.match!.rules).toEqual({ kind: 'first', goals: 7 });
  });
});
