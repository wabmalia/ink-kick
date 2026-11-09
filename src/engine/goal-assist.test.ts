import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { evenAttributes } from '../game/attributes';
import { createMatch, createPlayer, step, type Input, type Match, type Player, type Team } from './sim';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const held = { ...idle, kick: true };
const FULL = Math.ceil(CONFIG.kick.chargeTime / CONFIG.tick) + 5;
const LINE = CONFIG.pitch.width / 2;
const MOUTH = CONFIG.pitch.goalWidth / 2 - CONFIG.ball.radius;
const degrees = (p: Player) => Math.atan2(p.fy, p.fx) * 180 / Math.PI;

interface Shot { p: Player; m: Match }
function setup(x: number, y: number, heading: number, opts: { team?: Team; keeper?: boolean; power?: number } = {}): Shot {
  const p = createPlayer('me', opts.team ?? 'gold', { ...evenAttributes(), power: opts.power ?? 5 }, opts.keeper);
  const m = createMatch([p], { practice: true, seed: 1 });
  const a = heading * Math.PI / 180;
  Object.assign(p, { x, y, fx: Math.cos(a), fy: Math.sin(a), vx: 0, vy: 0 });
  Object.assign(m.ball, { x: x + p.fx * CONFIG.dribble.distance, y: y + p.fy * CONFIG.dribble.distance, vx: 0, vy: 0 });
  m.owner = p.id;
  return { p, m };
}
function advance(s: Shot, n: number, input = held) {
  for (let i = 0; i < n; i++) step(s.m, { me: input });
}
// Held across the kick's path, turned `amount` (0..1) of the way to a full
// curl, clockwise (side -1) or anticlockwise (side 1).
function curl(p: Player, amount: number, side: number): Input {
  const s = Math.min(1, 0.57 * amount) * side;
  const c = Math.sqrt(1 - s * s);
  return { ...idle, x: c * p.fx - s * p.fy, y: c * p.fy + s * p.fx };
}
// Releases with that curl held, and where the ball crosses the goal line
// (null if it never does: into a wall, or too slow).
function release(s: Shot, amount = 0, side = -1) {
  const input = curl(s.p, amount, side);
  const toX = s.p.team === 'gold' ? LINE : -LINE;
  for (let i = 0; i < 4 / CONFIG.tick; i++) {
    const { x, y } = s.m.ball;
    step(s.m, { me: input });
    const b = s.m.ball;
    if ((toX - x) * (toX - b.x) <= 0 && b.x !== x) return y + (b.y - y) * ((toX - x) / (b.x - x));
  }
  return null;
}
// Whether some amount of curl that way puts a fresh copy of this kick in,
// with the assist switched off so the aim stays as given.
function curlable(make: () => Shot, side = -1) {
  const kick = CONFIG.kick as { goalAssistRange: number };
  const range = kick.goalAssistRange;
  kick.goalAssistRange = 0;
  try {
    for (let amount = 0; amount <= 1.0001; amount += 0.05) {
      const s = make();
      advance(s, FULL);
      const y = release(s, amount, side);
      if (y !== null && Math.abs(y) < MOUTH) return true;
    }
    return false;
  } finally {
    kick.goalAssistRange = range;
  }
}

describe('goal assist while charging a shot', () => {
  it('leaves an aim alone that curl can already bring in', () => {
    const make = () => setup(5, 0, 25);
    const s = make();
    advance(s, FULL);
    expect(degrees(s.p)).toBeCloseTo(25, 5);
    expect(release(make())).toBeNull();
    expect(curlable(make)).toBe(true);
  });

  it('turns a hopeless aim only until curl can just bring it in', () => {
    const before = () => setup(5, 0, 35);
    expect(curlable(before)).toBe(false);
    const s = before();
    advance(s, FULL);
    const aimed = degrees(s.p);
    expect(aimed).toBeLessThan(35);
    // Still well off the goal: a straight strike misses, a curl scores.
    expect(aimed).toBeGreaterThan(20);
    const after = () => setup(5, 0, aimed);
    // Already within reach: holding the charge turns it no further.
    const check = after();
    advance(check, FULL);
    expect(degrees(check.p)).toBeCloseTo(aimed, 5);
    const straight = release(after());
    expect(straight === null || Math.abs(straight) > MOUTH).toBe(true);
    expect(curlable(after)).toBe(true);
  });

  it('turns slowly, and only once a tap would have become a shot', () => {
    const s = setup(5, 0, 45);
    const from = Math.ceil(CONFIG.kick.goalAssistFrom * CONFIG.kick.chargeTime / CONFIG.tick);
    advance(s, from - 1);
    expect(degrees(s.p)).toBeCloseTo(45, 5);
    advance(s, 20);
    const most = CONFIG.kick.goalAssistTurnRate * CONFIG.tick * 21 * 180 / Math.PI;
    expect(degrees(s.p)).toBeLessThan(45);
    expect(degrees(s.p)).toBeGreaterThanOrEqual(45 - most - 1e-9);
  });

  it('never steers a tap', () => {
    const s = setup(5, 0, 45);
    advance(s, 5);
    step(s.m, { me: idle });
    expect(Math.atan2(s.m.ball.vy, s.m.ball.vx) * 180 / Math.PI).toBeCloseTo(45, 5);
  });

  it('does nothing beyond its range of the goal', () => {
    const s = setup(LINE - CONFIG.kick.goalAssistRange - 0.5, 0, 45);
    advance(s, FULL);
    expect(degrees(s.p)).toBeCloseTo(45, 5);
  });

  it.each([90, -90, 135, -135, 180])('never pulls a sideways or backwards kick round (%s degrees)', heading => {
    const s = setup(5, 0, heading);
    advance(s, FULL);
    expect(degrees(s.p)).toBeCloseTo(heading, 5);
  });

  it('leaves keepers kicking out alone', () => {
    const s = setup(5, 0, 45, { keeper: true });
    advance(s, FULL);
    expect(degrees(s.p)).toBeCloseTo(45, 5);
  });

  it('mirrors for Red attacking the other goal', () => {
    const gold = setup(5, 0, 35);
    const red = setup(-5, 0, 145, { team: 'red' });
    advance(gold, FULL);
    advance(red, FULL);
    expect(degrees(red.p)).toBeCloseTo(180 - degrees(gold.p), 5);
  });

  it('gives a weaker curler more help than a stronger one', () => {
    const weak = setup(5, 0, 35, { power: 1 });
    const strong = setup(5, 0, 35, { power: 10 });
    advance(weak, FULL);
    advance(strong, FULL);
    expect(degrees(weak.p)).toBeLessThan(degrees(strong.p));
  });

  it('keeps the direction keys for curl: they never steer the charge', () => {
    // Either key walks you on the way you face, so only the assist turns you.
    const left = setup(5, 0, 25);
    const right = setup(5, 0, 25);
    advance(left, FULL, { ...held, y: 1 });
    advance(right, FULL, { ...held, y: -1 });
    expect(degrees(left.p)).toBeCloseTo(degrees(right.p), 5);
    expect(left.p.x).toBeCloseTo(right.p.x, 5);
  });

  it('stops turning once the charge is called off', () => {
    const s = setup(5, 0, 45);
    advance(s, 20);
    step(s.m, { me: { ...held, sprint: true } });
    expect(s.p.action).toBe('none');
    const before = degrees(s.p);
    advance(s, 10, idle);
    expect(degrees(s.p)).toBeCloseTo(before, 5);
  });
});
