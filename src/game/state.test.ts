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
  tick, ball: [0, 0], owner: null, score: [0, 0], clock: 0,
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
