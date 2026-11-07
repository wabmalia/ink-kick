import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { evenAttributes } from '../game/attributes';
import { createMatch, createPlayer, step, type Input, type Match, type Player } from './sim';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const ticks = (seconds: number) => Math.round(seconds / CONFIG.tick);

// A red dribbler standing at the origin facing -x, the ball at their feet,
// and a gold defender out in front of them at distance d, facing them.
function setup(d: number) {
  const match = createMatch([createPlayer('def', 'gold', evenAttributes()), createPlayer('att', 'red', evenAttributes())], { practice: true });
  match.kickoffHeld = false;
  const [def, att] = match.players as [Player, Player];
  Object.assign(att, { x: 0, y: 0, vx: 0, vy: 0, fx: -1, fy: 0 });
  Object.assign(def, { x: -d, y: 0, vx: 0, vy: 0, fx: 1, fy: 0 });
  Object.assign(match.ball, { x: -CONFIG.dribble.distance, y: 0, vx: 0, vy: 0 });
  match.owner = att.id;
  return { match, def, att };
}

function run(match: Match, n: number, inputs: Record<string, Partial<Input>> = {}) {
  const full = Object.fromEntries(Object.entries(inputs).map(([id, i]) => [id, { ...idle, ...i }]));
  for (let i = 0; i < n; i++) step(match, full);
}

describe('defensive stance', () => {
  it('squares up to the dribbler in range and facing them, not further out', () => {
    const near = setup(CONFIG.guard.enter - 0.5);
    run(near.match, 1);
    expect(near.def.guarding).toBe('att');
    const far = setup(CONFIG.guard.enter + 0.5);
    run(far.match, 1);
    expect(far.def.guarding).toBeUndefined();
  });

  it('not when looking away from them', () => {
    const { match, def } = setup(3);
    Object.assign(def, { fx: 0, fy: 1 });
    run(match, 1);
    expect(def.guarding).toBeUndefined();
  });

  it('keeps facing them whichever way it moves, until past the leave range', () => {
    const { match, def } = setup(3);
    run(match, 1);
    // Across, then back: still looking at the dribbler.
    run(match, ticks(0.4), { def: { y: 1 } });
    expect(def.guarding).toBe('att');
    expect(def.fx).toBeGreaterThan(0.9);
    run(match, ticks(0.4), { def: { x: -1 } });
    expect(def.guarding).toBe('att');
    expect(def.fx).toBeGreaterThan(0.9);
    // Between the ranges: held.
    def.x = -(CONFIG.guard.enter + CONFIG.guard.leave) / 2;
    run(match, 1);
    expect(def.guarding).toBe('att');
    def.x = -CONFIG.guard.leave - 0.5;
    run(match, 1);
    expect(def.guarding).toBeUndefined();
  });

  it('backs off slower than it steps in', () => {
    const fwd = setup(3.5);
    run(fwd.match, ticks(0.5), { def: { x: 1 } });
    const back = setup(3.5);
    run(back.match, ticks(0.5), { def: { x: -1 } });
    expect(back.def.guarding).toBe('att');
    expect(Math.abs(back.def.vx)).toBeCloseTo(fwd.def.stats.runSpeed * CONFIG.guard.backSpeed, 1);
    expect(Math.abs(back.def.vx)).toBeLessThan(Math.abs(fwd.def.vx));
  });

  it('lets go to sprint', () => {
    const { match, def } = setup(3);
    run(match, 1);
    expect(def.guarding).toBe('att');
    run(match, 1, { def: { y: 1, sprint: true } });
    expect(def.guarding).toBeUndefined();
  });

  it('slides at the dribbler, wherever it was stepping', () => {
    const { match, def } = setup(3.5);
    run(match, ticks(0.3), { def: { y: 1 } });
    run(match, 1, { def: { y: 1, kick: true } });
    expect(def.action).toBe('slide');
    expect(def.vx).toBeGreaterThan(Math.abs(def.vy));
  });
});

describe('the stance cone', () => {
  it('squares up only with them inside the cone ahead', () => {
    const turned = (deg: number) => {
      const { match, def } = setup(3);
      const a = (deg * Math.PI) / 180;
      Object.assign(def, { fx: Math.cos(a), fy: Math.sin(a) });
      run(match, 1);
      return def.guarding;
    };
    expect(turned(CONFIG.guard.cone - 5)).toBe('att');
    expect(turned(CONFIG.guard.cone + 5)).toBeUndefined();
  });

  it("lets go once they're out of the wider cone, not before", () => {
    const look = (deg: number) => {
      const { match, def } = setup(3);
      run(match, 1);
      const a = (deg * Math.PI) / 180;
      Object.assign(def, { fx: Math.cos(a), fy: Math.sin(a) });
      run(match, 1);
      return def.guarding;
    };
    expect(look((CONFIG.guard.cone + CONFIG.guard.coneLeave) / 2)).toBe('att');
    expect(look(CONFIG.guard.coneLeave + 5)).toBeUndefined();
  });

  it('not from behind them: chasing, not squaring up', () => {
    const at = (deg: number, squaredFirst: boolean) => {
      const { match, def } = setup(3);
      if (squaredFirst) run(match, 1);
      // 3m away, deg round from the way they face, looking at them.
      const a = (deg * Math.PI) / 180;
      Object.assign(def, { x: -3 * Math.cos(a), y: 3 * Math.sin(a), vx: 0, vy: 0 });
      const len = Math.hypot(def.x, def.y);
      Object.assign(def, { fx: -def.x / len, fy: -def.y / len });
      run(match, 1);
      return def.guarding;
    };
    const g = CONFIG.guard;
    expect(at(g.front - 5, false)).toBe('att');
    expect(at(g.front + 3, false)).toBeUndefined();
    expect(at(180, false)).toBeUndefined();
    // Held a little past the edge once in, not further.
    expect(at((g.front + g.frontLeave) / 2, true)).toBe('att');
    expect(at(g.frontLeave + 5, true)).toBeUndefined();
  });
});
