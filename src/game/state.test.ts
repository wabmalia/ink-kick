import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import type { Snapshot } from '../net/protocol';
import { createMatch, createPlayer, setAction } from '../engine/sim';
import { evenAttributes } from './attributes';
import { RemoteMatch, toSnapshot } from './state';

describe('what a guest is sent', () => {
  it("carries a stumble's real length and who's sprinting", () => {
    const weak = createPlayer('weak', 'gold', { ...evenAttributes(), strength: 1 });
    const quick = createPlayer('quick', 'red');
    const match = createMatch([weak, quick]);
    setAction(weak, 'stumble');
    quick.sprinting = true;
    const remote = new RemoteMatch();
    remote.push(toSnapshot(match, 1));
    remote.push(toSnapshot(match, 2));
    remote.advance(0);
    const [w, q] = remote.state()!.players;
    // Strength 1 stays down well past the 0.5 s a Strength 5 does.
    expect(w!.stumble).toBeCloseTo(weak.stats.stumbleTime, 2);
    expect(w!.stumble).toBeGreaterThan(0.8);
    expect(q!.stumble).toBe(0);
    expect(q!.sprinting).toBe(true);
    expect(w!.sprinting).toBe(false);
  });
});

// One player standing at x, on a given host tick.
const snap = (tick: number, x: number): Snapshot => ({
  matchId: 'local', tick, ball: [0, 0], owner: null, score: [0, 0], clock: 0,
  players: [['a', 0, x, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]],
});

describe('a guest drawing snapshots', () => {
  it('slots a late one in and drops a repeat, so it never jumps back', () => {
    const remote = new RemoteMatch();
    remote.push(snap(10, 10));
    remote.push(snap(30, 30));
    remote.push(snap(20, 20));
    // The same tick again, wrong: ignored.
    remote.push(snap(20, 999));
    let last = -Infinity;
    for (let i = 0; i < 40; i++) {
      remote.advance(CONFIG.tick / 2);
      const x = remote.state()!.players[0]!.x;
      expect(x).toBeLessThanOrEqual(30);
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
    }
  });

  it('jumps straight to the right time when it falls far behind', () => {
    const remote = new RemoteMatch();
    remote.push(snap(10, 10));
    remote.advance(0);
    const far = 10 + CONFIG.net.resyncTicks + 50;
    remote.push(snap(far, far));
    remote.push(snap(far + 2, far + 2));
    remote.advance(0);
    expect(remote.state()!.players[0]!.x).toBeGreaterThan(far - CONFIG.net.delayTicks - 3);
  });
});


describe('snapshot recovery boundaries', () => {
  it('does not rewind for a snapshot older than its useful history', () => {
    const remote = new RemoteMatch();
    remote.push(snap(100, 100));
    remote.push(snap(102, 102));
    remote.advance(0);
    const before = remote.state()!.players[0]!.x;
    remote.push(snap(10, 10));
    remote.advance(0);
    expect(remote.state()!.players[0]!.x).toBe(before);
  });

  it('rejects another match until explicitly reset and clears queued events', () => {
    const remote = new RemoteMatch();
    remote.push(snap(500, 50));
    remote.pushEvents(510, [{ type: 'kickoff' }]);
    const next = { ...snap(0, -5), matchId: 'next-match' };
    remote.push(next);
    expect(remote.state()!.players[0]!.x).toBe(50);
    remote.reset(next);
    remote.push(snap(600, 999));
    expect(remote.state()!.players[0]!.x).toBe(-5);
    expect(remote.advance(10)).toEqual([]);
  });

  it('keeps a bounded snapshot history while the guest is not drawing', () => {
    const remote = new RemoteMatch();
    for (let i = 0; i < 2000; i++) remote.push(snap(i, i));
    remote.advance(0);
    expect(remote.state()!.players[0]!.x).toBeGreaterThan(1900);
    remote.push(snap(100, -999));
    expect(remote.state()!.players[0]!.x).toBeGreaterThan(1900);
  });
});

describe('how far behind a guest draws', () => {
  const MS = CONFIG.tick * 1000;
  // Snapshots every other tick, each arriving `late(i)` ms after its time.
  function feed(late: (i: number) => number, count = 150) {
    const remote = new RemoteMatch();
    for (let i = 1; i <= count; i++) remote.push(snap(i * 2, 0), i * 2 * MS + late(i));
    return remote;
  }

  it('starts at the default until it has heard enough', () => {
    expect(feed(() => 0, CONFIG.net.jitterSamples - 1).delay).toBe(CONFIG.net.delayTicks);
  });

  it('draws close to now on a steady line, however slow', () => {
    expect(feed(() => 0).delay).toBe(CONFIG.net.minDelayTicks);
    expect(feed(() => 300).delay).toBe(CONFIG.net.minDelayTicks);
  });

  it('draws further back the more unevenly snapshots arrive, up to a limit', () => {
    // Up to 50 ms late, evenly spread: about 3 ticks of spread.
    const choppy = feed(i => (i * 37) % 51);
    expect(choppy.delay).toBeGreaterThan(CONFIG.net.minDelayTicks + 1);
    expect(choppy.delay).toBeLessThan(CONFIG.net.maxDelayTicks);
    expect(feed(i => (i * 37) % 1000).delay).toBe(CONFIG.net.maxDelayTicks);
  });

  it('ignores a rare straggler', () => {
    expect(feed(i => (i % 50 === 0 ? 400 : 0)).delay).toBe(CONFIG.net.minDelayTicks);
  });

  it('settles back once a choppy spell has passed', () => {
    const remote = feed(i => (i * 37) % 51);
    for (let i = 151; i <= 300; i++) remote.push(snap(i * 2, 0), i * 2 * MS);
    expect(remote.delay).toBe(CONFIG.net.minDelayTicks);
  });
});
