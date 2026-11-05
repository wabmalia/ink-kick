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
    at(t, SPRINT.x, SPRINT.gates[0] - 1);
    const result = runLane(t, SPRINT, go(0, 1, { sprint: true }));
    expect(result).not.toBeNull();
    // 15 m: two seconds and a bit at a sprint.
    expect(result!.time).toBeGreaterThan(1.7);
    expect(result!.time).toBeLessThan(3.5);
    expect(result!.withBall).toBe(false);
    expect(t.stats().lanes[0]!.best.without).toBe(result!.time);
  });

  it('is quicker with Pace 10', () => {
    const time = (pace: number) => {
      const t = new Training('me', { ...evenAttributes(), pace });
      at(t, SPRINT.x, SPRINT.gates[0] - 1);
      return runLane(t, SPRINT, go(0, 1))!.time;
    };
    expect(time(10)).toBeLessThan(time(1) * 0.8);
  });

  it('calls a run off when you leave the lane', () => {
    const t = new Training('me', evenAttributes());
    at(t, SPRINT.x, SPRINT.gates[0] - 0.5);
    for (let i = 0; i < ticks(0.5); i++) t.step(go(0, 1));
    expect(t.stats().lanes[0]!.running).not.toBeNull();
    for (let i = 0; i < ticks(1); i++) t.step(go(1, 0));
    expect(t.stats().lanes[0]!.running).toBeNull();
  });

  it('puts cones in the cone lane that block the way', () => {
    const t = new Training('me', evenAttributes());
    const me = at(t, CONES.x, CONES.gates[0] - 1);
    for (let i = 0; i < ticks(3); i++) t.step(go(0, 1));
    // Straight down the middle, the first cone stops you.
    expect(me.y).toBeLessThan(-5.5);
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
    // Tackling 9 against the dummy's Strength 5: the poke always wins.
    const t = new Training('me', { ...evenAttributes(), tackling: 9, pace: 1 });
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

  it('counts shots at the keeper and goals past it, and the keeper rolls the ball back', () => {
    const t = new Training('me', { ...evenAttributes(), power: 10 });
    const keeper = t.match.players.find(p => p.keeper)!;
    const W = CONFIG.pitch.width / 2;
    let rolledBack = false;
    for (let n = 0; n < 12; n++) {
      // On the ball 8 m out, a hard shot into a corner or straight at it.
      const y = [2.2, 0, -2.2, 0][n % 4]!;
      const me = at(t, W - 8, 0);
      const l = Math.hypot(8, y);
      Object.assign(me, { fx: 8 / l, fy: y / l });
      Object.assign(t.match.ball, { x: me.x + (8 / l) * 0.6, y: (y / l) * 0.6, vx: 0, vy: 0 });
      t.match.owner = 'me';
      for (let i = 0; i < ticks(0.7); i++) t.step(go(0, 0, { kick: true }));
      for (let i = 0; i < ticks(4); i++) {
        t.step(go(0, 0));
        if (t.match.owner === 'me') break;
        if (t.match.owner === null && t.match.ball.vx < -1 && Math.abs(t.match.ball.x - keeper.x) < 2) rolledBack = true;
      }
    }
    const k = t.stats().keeper;
    expect(k.shots).toBeGreaterThan(8);
    expect(k.goals).toBeGreaterThan(0);
    expect(k.goals).toBeLessThan(k.shots);
    expect(rolledBack).toBe(true);
  });

  it('the dummy has its ball back a moment after each win, so you can go again', () => {
    const t = new Training('me', { ...evenAttributes(), tackling: 9, pace: 1 });
    const me = t.match.players[0]!;
    const dummy = t.match.players.find(p => p.id === 'dummy')!;
    Object.assign(me, { x: DUMMY_SPOT.x - 3, y: DUMMY_SPOT.y, vx: 0, vy: 0 });
    for (let rep = 0; rep < 5; rep++) {
      // Walk at it until the ball is close, poke, then stand there.
      for (let i = 0; i < ticks(5); i++) {
        const b = t.match.ball;
        if (t.match.owner === dummy.id && Math.hypot(b.x - me.x, b.y - me.y) - me.r - b.r < 0.4) break;
        const dx = dummy.x - me.x;
        const dy = dummy.y - me.y;
        const l = Math.hypot(dx, dy) || 1;
        t.step(go(dx / l, dy / l));
      }
      t.step(go(0, 0, { kick: true }));
      for (let i = 0; i < ticks(1.6); i++) t.step(go(0, 0));
      expect(t.match.owner).toBe(dummy.id);
    }
    expect(t.stats().tackle).toMatchObject({ pokes: 5, pokesWon: 5 });
  });
});
