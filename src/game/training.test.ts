import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { evenAttributes } from './attributes';
import { CONES, DUEL, DUMMY_SPOT, SPRINT, TACKLE, Training } from './training';
import type { Input } from '../engine/sim';

const go = (x: number, y: number, extra: Partial<Input> = {}): Input => ({ x, y, kick: false, sprint: false, ...extra });
const ticks = (s: number) => Math.round(s / CONFIG.tick);

function at(t: Training, x: number, y: number) {
  const me = t.match.players[0]!;
  Object.assign(me, { x, y, vx: 0, vy: 0, fx: 1, fy: 0 });
  return me;
}

// Runs right along a lane until the clock stops, or gives up.
function runLane(t: Training, lane: typeof SPRINT, input: Input) {
  for (let i = 0; i < ticks(12); i++) {
    t.step(input);
    const r = t.stats().lanes.find(l => l.name === lane.name)!;
    if (r.last) return r.last;
  }
  return null;
}

describe('training ground', () => {
  it('times the sprint lane from gate to gate', () => {
    const t = new Training('me', evenAttributes());
    at(t, SPRINT.gates[0] - 1, SPRINT.y);
    const result = runLane(t, SPRINT, go(1, 0, { sprint: true }));
    expect(result).not.toBeNull();
    // 20 m: roughly three seconds at a sprint, the stamina running low.
    expect(result!.time).toBeGreaterThan(2.4);
    expect(result!.time).toBeLessThan(4.5);
    expect(result!.withBall).toBe(false);
    expect(t.stats().lanes[0]!.best.without).toBe(result!.time);
  });

  it('is quicker with Pace 10', () => {
    const time = (pace: number) => {
      const t = new Training('me', { ...evenAttributes(), pace });
      at(t, SPRINT.gates[0] - 1, SPRINT.y);
      return runLane(t, SPRINT, go(1, 0))!.time;
    };
    expect(time(10)).toBeLessThan(time(1) * 0.8);
  });

  it('calls a run off when you leave the lane', () => {
    const t = new Training('me', evenAttributes());
    at(t, SPRINT.gates[0] - 0.5, SPRINT.y);
    for (let i = 0; i < ticks(0.5); i++) t.step(go(1, 0));
    expect(t.stats().lanes[0]!.running).not.toBeNull();
    for (let i = 0; i < ticks(1); i++) t.step(go(0, 1));
    expect(t.stats().lanes[0]!.running).toBeNull();
  });

  it('puts cones in the cone lane that block the way', () => {
    const t = new Training('me', evenAttributes());
    const me = at(t, CONES.gates[0] - 1, CONES.y);
    for (let i = 0; i < ticks(3); i++) t.step(go(1, 0));
    // Straight down the middle, the first cone stops you.
    expect(me.x).toBeLessThan(-7);
  });

  it('a prop ball touched with your feet free becomes the real one', () => {
    const t = new Training('me', evenAttributes());
    const prop = { ...t.props[0]! };
    at(t, prop.x - 0.75, prop.y);
    t.step(go(1, 0));
    t.step(go(1, 0));
    expect(Math.hypot(t.match.ball.x - prop.x, t.match.ball.y - prop.y)).toBeLessThan(0.8);
    expect(t.props.some(p => p.x === prop.x && p.y === prop.y)).toBe(false);
  });

  it('the bot challenges a ball carried into the duel box, and the card counts', () => {
    const t = new Training('me', evenAttributes());
    const me = at(t, DUEL.x - 2, DUEL.y);
    Object.assign(t.match.ball, { x: me.x + 0.6, y: me.y, vx: 0, vy: 0 });
    t.match.owner = 'me';
    for (let i = 0; i < ticks(8) && t.stats().duel.lost === 0; i++) t.step(go(0, 0));
    const duel = t.stats().duel;
    expect(duel.challenges).toBeGreaterThan(0);
    expect(duel.lost).toBe(1);
    expect(duel.best).toBeGreaterThan(0.5);
  });

  it('the dummy holds a ball once you step into its box, and counts a won poke', () => {
    const t = new Training('me', evenAttributes());
    const dummy = t.match.players.find(p => p.id === 'dummy')!;
    // Face it from inside its box, close enough to poke.
    const me = at(t, DUMMY_SPOT.x - 1.6, DUMMY_SPOT.y);
    expect(Math.abs(me.x - TACKLE.x)).toBeLessThan(TACKLE.hw);
    for (let i = 0; i < ticks(1.5); i++) t.step(go(0, 0));
    expect(t.match.owner).toBe(dummy.id);
    Object.assign(me, { x: dummy.x - 1.4, y: dummy.y, fx: 1, fy: 0 });
    t.step(go(0, 0, { kick: true }));
    for (let i = 0; i < ticks(0.4); i++) t.step(go(0, 0));
    const tackle = t.stats().tackle;
    expect(tackle.pokes).toBe(1);
    expect(tackle.pokesWon).toBe(1);
  });
});
