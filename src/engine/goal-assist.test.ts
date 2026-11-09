import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { angleBetween } from '../math';
import { createMatch, createPlayer, step, type Input, type Player, type Team } from './sim';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const held = { ...idle, kick: true };
const degrees = (p: Player) => Math.atan2(p.fy, p.fx) * 180 / Math.PI;
function setup(x = 10, y = 0, heading = 45, team: Team = 'gold', keeper = false) {
  const p = createPlayer('me', team, undefined, keeper);
  const m = createMatch([p], { practice: true, seed: 1 });
  const a = heading * Math.PI / 180;
  Object.assign(p, { x, y, fx: Math.cos(a), fy: Math.sin(a), vx: 0, vy: 0 });
  Object.assign(m.ball, { x: x + p.fx * CONFIG.dribble.distance, y: y + p.fy * CONFIG.dribble.distance, vx: 0, vy: 0 });
  m.owner = p.id;
  return { p, m };
}
function advance(s: ReturnType<typeof setup>, n: number, input = held) {
  for (let i = 0; i < n; i++) step(s.m, { me: input });
}

describe('goal-facing assistance during charging', () => {
  it('turns at the slow configured rate, then stops exactly at the cone edge', () => {
    const s = setup();
    advance(s, 15);
    expect(degrees(s.p)).toBeCloseTo(45 - CONFIG.kick.goalAssistTurnRate * CONFIG.tick * 15 * 180 / Math.PI, 5);
    advance(s, 120);
    expect(degrees(s.p)).toBeCloseTo(CONFIG.kick.goalAssistCone, 5);
    expect(s.m.owner).toBe('me');
    expect(s.m.spin).toBe(0);
  });

  it('does not steer while dribbling without charging', () => {
    const s = setup();
    advance(s, 60, idle);
    expect(degrees(s.p)).toBeCloseTo(45, 5);
  });

  it.each([0, CONFIG.kick.goalAssistCone / 2, -CONFIG.kick.goalAssistCone / 2, CONFIG.kick.goalAssistCone, -CONFIG.kick.goalAssistCone])('preserves intentional aim already inside the cone (%s degrees)', heading => {
    const s = setup(10, 0, heading);
    advance(s, 60);
    expect(degrees(s.p)).toBeCloseTo(heading, 5);
  });

  it('uses distance to the goal centre and includes the configured range boundary', () => {
    const out = setup(15 - CONFIG.kick.goalAssistRange - 0.01);
    advance(out, 30);
    expect(degrees(out.p)).toBeCloseTo(45, 5);
    const edge = setup(15 - CONFIG.kick.goalAssistRange);
    advance(edge, 1);
    expect(degrees(edge.p)).toBeLessThan(45);
    // Inside the longitudinal range, but outside the radial range out wide.
    const lateral = Math.min(CONFIG.pitch.height / 3, CONFIG.kick.goalAssistRange * 0.6);
    const along = Math.sqrt(CONFIG.kick.goalAssistRange ** 2 - lateral ** 2) + 0.1;
    const wide = setup(15 - along, lateral, 45);
    advance(wide, 30);
    expect(degrees(wide.p)).toBeCloseTo(45, 5);
  });

  it.each([90, -90, 135, -135, 180])('never pulls a sideways or backwards kick around (%s degrees)', heading => {
    const s = setup(10, 0, heading);
    advance(s, 60);
    expect(Math.abs(angleBetween(heading * Math.PI / 180, Math.atan2(s.p.fy, s.p.fx)))).toBeLessThan(1e-9);
  });

  it('mirrors the assistance for the opposing team', () => {
    const gold = setup(10, 0, 45);
    const red = setup(-10, 0, 135, 'red');
    advance(gold, 20);
    advance(red, 20);
    expect(degrees(gold.p)).toBeCloseTo(35, 5);
    expect(degrees(red.p)).toBeCloseTo(145, 5);
  });

  it('excludes keeper distribution', () => {
    const s = setup(10, 0, 45, 'gold', true);
    advance(s, 30);
    expect(degrees(s.p)).toBeCloseTo(45, 5);
  });

  it('applies even without movement keys and releases a kick on the assisted heading', () => {
    const s = setup();
    advance(s, 20);
    expect(Math.hypot(s.p.vx, s.p.vy)).toBe(0);
    step(s.m, { me: idle });
    const shot = Math.atan2(s.m.ball.vy, s.m.ball.vx) * 180 / Math.PI;
    expect(shot).toBeCloseTo(34.5, 5);
    expect(s.m.owner).toBeNull();
    // Curl still uses the usual post-release input.
    advance(s, 3, { ...idle, y: -1 });
    expect(s.m.spin).toBeLessThan(0);
  });

  it('moves along assisted facing while charging, rather than the held input direction', () => {
    const s = setup();
    advance(s, 20, { ...held, y: 1 });
    expect(degrees(s.p)).toBeLessThan(45);
    expect(s.p.vx).toBeGreaterThan(0);
    expect(s.p.vy).toBeGreaterThan(0);
    expect(s.m.owner).toBe('me');
  });

  it('does not assist a cancelled charge', () => {
    const s = setup();
    advance(s, 2);
    const before = degrees(s.p);
    step(s.m, { me: { ...held, sprint: true } });
    expect(s.p.action).toBe('none');
    expect(degrees(s.p)).toBeCloseTo(before, 5);
  });
});
