import { describe, expect, it } from 'vitest';
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
