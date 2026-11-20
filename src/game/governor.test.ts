import { describe, expect, it } from 'vitest';
import { Governor, LEVELS, SETTLE_MS, UPGRADE_AFTER_MS, WINDOW_MS } from './governor';

/** Feeds frames of `ms` for `total` ms; returns the levels it moved to. */
function run(g: Governor, ms: number, total: number) {
  const moves: number[] = [];
  for (let t = 0; t < total; t += ms) {
    const to = g.frame(ms);
    if (to !== null) moves.push(to);
  }
  return moves;
}

describe('Governor', () => {
  it('starts sharpest, without multisampling', () => {
    const g = new Governor();
    expect(g.level).toBe(0);
    expect(g.quality.samples).toBe(0);
    expect(g.quality.ratio).toBe(1.5);
  });

  it('stays put at a steady 60', () => {
    expect(run(new Governor(), 1000 / 60, 60000)).toEqual([]);
  });

  it('steps down within a few seconds of late frames, one level at a time', () => {
    const g = new Governor();
    const moves = run(g, 24, SETTLE_MS + WINDOW_MS + 100);
    expect(moves).toEqual([1]);
    // Still late at the next level: down again after it settles.
    expect(run(g, 24, SETTLE_MS + WINDOW_MS + 100)).toEqual([2]);
  });

  it('ignores the frames right after starting', () => {
    const g = new Governor();
    expect(run(g, 40, SETTLE_MS - 100)).toEqual([]);
  });

  it('does not count one stall as a slow device', () => {
    const g = new Governor();
    run(g, 1000 / 60, SETTLE_MS);
    expect(g.frame(800)).toBeNull();
    expect(run(g, 1000 / 60, WINDOW_MS * 2)).toEqual([]);
  });

  it('climbs back after long steady play, and never retries a level that ran late', () => {
    const g = new Governor(1);
    expect(run(g, 1000 / 60, SETTLE_MS + UPGRADE_AFTER_MS + 100)).toEqual([0]);
    // Level 0 runs late: back to 1, and level 0 is off for the session.
    expect(run(g, 24, SETTLE_MS + WINDOW_MS + 100)).toEqual([1]);
    expect(run(g, 1000 / 60, SETTLE_MS + UPGRADE_AFTER_MS * 3)).toEqual([]);
    expect(g.level).toBe(1);
  });

  it('bottoms out at the last level', () => {
    const g = new Governor(LEVELS.length - 1);
    expect(run(g, 40, 20000)).toEqual([]);
  });

  it('starts fresh after a pause', () => {
    const g = new Governor();
    run(g, 24, SETTLE_MS + WINDOW_MS - 200);
    g.pause();
    // The late frames before the pause don't count.
    expect(run(g, 1000 / 60, SETTLE_MS + WINDOW_MS + 100)).toEqual([]);
  });
});
