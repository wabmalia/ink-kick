import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { evenAttributes } from '../game/attributes';
import { createMatch, createPlayer, step, type Input, type Match, type Team } from './sim';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const rad = (deg: number) => deg * Math.PI / 180;
const deg = (r: number) => r * 180 / Math.PI;

interface Mate { id: string; team?: Team; keeper?: boolean; at: [number, number] }
// Gold's 'me' on the ball at (-8, 0) facing `heading`, and the others where
// given, each facing the ball. Well away from either goal.
function setup(heading: number, others: Mate[]) {
  const me = createPlayer('me', 'gold', evenAttributes());
  const rest = others.map(o => createPlayer(o.id, o.team ?? 'gold', evenAttributes(), o.keeper));
  const match = createMatch([me, ...rest], { practice: true, seed: 1 });
  const a = rad(heading);
  Object.assign(me, { x: -8, y: 0, fx: Math.cos(a), fy: Math.sin(a), vx: 0, vy: 0 });
  Object.assign(match.ball, { x: me.x + me.fx * CONFIG.dribble.distance, y: me.y + me.fy * CONFIG.dribble.distance, vx: 0, vy: 0 });
  for (const o of others) {
    const q = match.players.find(p => p.id === o.id)!;
    const [x, y] = o.at;
    const l = Math.hypot(match.ball.x - x, match.ball.y - y);
    Object.assign(q, { x, y, fx: (match.ball.x - x) / l, fy: (match.ball.y - y) / l, vx: 0, vy: 0 });
  }
  match.owner = me.id;
  return { match, me };
}
// Holds the kick `hold` ticks and lets go: the way the kick set off.
function kick(match: Match, hold = 2, inputs: Record<string, Input> = {}) {
  for (let i = 0; i < hold; i++) step(match, { ...inputs, me: { ...idle, kick: true } });
  step(match, { ...inputs, me: idle });
  return deg(Math.atan2(match.ball.vy, match.ball.vx) - match.curled);
}
function received(match: Match, id: string, inputs: Record<string, Input> = {}) {
  for (let i = 0; i < 180 && match.owner !== id; i++) step(match, inputs);
  return match.owner === id;
}
function withoutAssist(fn: () => void) {
  const kick = CONFIG.kick as { passAssistCone: number };
  const was = kick.passAssistCone;
  kick.passAssistCone = 0;
  try {
    fn();
  } finally {
    kick.passAssistCone = was;
  }
}

describe('pass assist', () => {
  it('leaves the foot the way you face, then curls onto a teammate off to one side', () => {
    const { match } = setup(0, [{ id: 'mate', at: [-2, 1] }]);
    expect(kick(match)).toBeCloseTo(0, 5);
    // Left of the line, so it curls left (positive spin), and the keys
    // after it don't add more.
    expect(match.spin).toBeGreaterThan(0);
    expect(match.aftertouch).toBeNull();
    expect(received(match, 'mate')).toBe(true);
  });

  it('would miss them without it', () => {
    withoutAssist(() => {
      const { match } = setup(0, [{ id: 'mate', at: [-2, 1] }]);
      kick(match);
      expect(received(match, 'mate')).toBe(false);
    });
  });

  it('meets a teammate coming short, leading their run', () => {
    const run = { ...idle, x: -1 };
    const { match } = setup(0, [{ id: 'mate', at: [3, -1.6] }]);
    for (let i = 0; i < 20; i++) step(match, { mate: run, me: idle });
    kick(match, 2, { mate: run });
    expect(match.spin).toBeLessThan(0);
    expect(received(match, 'mate', { mate: run })).toBe(true);
    withoutAssist(() => {
      const plain = setup(0, [{ id: 'mate', at: [3, -1.6] }]);
      for (let i = 0; i < 20; i++) step(plain.match, { mate: run, me: idle });
      kick(plain.match, 2, { mate: run });
      expect(received(plain.match, 'mate', { mate: run })).toBe(false);
    });
  });

  it('works up to a 30% charge, and not past it', () => {
    const ticks = (charge: number) => Math.floor(charge * CONFIG.kick.chargeTime / CONFIG.tick);
    const firm = setup(0, [{ id: 'mate', at: [2, 1.5] }]);
    kick(firm.match, ticks(CONFIG.kick.passAssistCharge) - 1);
    expect(firm.match.spin).toBeGreaterThan(0);
    const hard = setup(0, [{ id: 'mate', at: [2, 1.5] }]);
    kick(hard.match, ticks(CONFIG.kick.passAssistCharge) + 3);
    expect(hard.match.spin).toBe(0);
    expect(hard.match.aftertouch).not.toBeNull();
  });

  it('leaves a pass alone with no teammate in the cone, close enough', () => {
    const wide = setup(0, [{ id: 'mate', at: [-2, 3] }]);
    kick(wide.match);
    expect(wide.match.spin).toBe(0);
    expect(wide.match.aftertouch).not.toBeNull();
    const far = setup(0, [{ id: 'mate', at: [-8 + CONFIG.dribble.distance + CONFIG.kick.passAssistRange + 0.5, 0.5] }]);
    kick(far.match);
    expect(far.match.spin).toBe(0);
  });

  it('ignores opponents and its own keeper', () => {
    const others: Mate[] = [{ id: 'them', team: 'red', at: [-2, 1] }, { id: 'gk', keeper: true, at: [-2, 1] }];
    for (const other of others) {
      const { match } = setup(0, [other]);
      kick(match);
      expect(match.spin).toBe(0);
    }
  });

  it('curls towards the teammate nearest the facing', () => {
    const { match } = setup(0, [{ id: 'near', at: [-2, -0.8] }, { id: 'far', at: [-2, 1.4] }]);
    kick(match);
    expect(match.spin).toBeLessThan(0);
  });

  it('puts on no more than the passer could', () => {
    // Close, and as far round as the cone goes: more than anyone can curl.
    const { match, me } = setup(0, [{ id: 'mate', at: [-4.5, 0.72] }]);
    kick(match);
    // Read a tick after the kick, so it has faded that much already.
    expect(match.spin).toBeCloseTo(me.stats.curl * Math.exp(-CONFIG.kick.spinFade * CONFIG.tick), 6);
  });
});
