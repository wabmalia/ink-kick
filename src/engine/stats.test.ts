import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { evenAttributes, type Attribute } from '../game/attributes';
import { createMatch, createPlayer, step, type Input, type Match } from './sim';
import { statsFor } from './stats';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const ticks = (seconds: number) => Math.round(seconds / CONFIG.tick);
const build = (k: Attribute, v: number) => ({ ...evenAttributes(), [k]: v });

function run(match: Match, n: number, inputs: Record<string, Partial<Input>>) {
  const full = Object.fromEntries(Object.entries(inputs).map(([id, i]) => [id, { ...idle, ...i }]));
  for (let i = 0; i < n; i++) step(match, full);
}

describe('stats from attributes', () => {
  it('at 5 everywhere, match the shared config', () => {
    const s = statsFor(evenAttributes());
    expect(s.runSpeed).toBe(CONFIG.player.runSpeed);
    expect(s.sprintSpeed).toBe(CONFIG.player.sprintSpeed);
    expect(s.chargeTime).toBe(CONFIG.kick.chargeTime);
    expect(s.pokeRange).toBe(CONFIG.tackle.pokeRange);
    expect(s.slideControlCos).toBeCloseTo(CONFIG.tackle.slideControlCos);
    expect(s.turnSlowdown).toBeCloseTo(CONFIG.dribble.turnSlowdown);
  });

  it('match the table in docs/attributes.md at 1 and 10', () => {
    expect(statsFor(build('pace', 10)).sprintSpeed).toBeCloseTo(9, 2);
    expect(statsFor(build('pace', 1)).sprintSpeed).toBeCloseTo(6.3, 2);
    expect(1 / statsFor(build('stamina', 10)).drain).toBeCloseTo(3.6, 2);
    expect(statsFor(build('power', 10)).shotSpeed).toBeCloseTo(39.6, 2);
    expect(statsFor(build('tackling', 1)).pokeRange).toBeCloseTo(0.408, 3);
    expect(statsFor(build('strength', 10)).loseDistance).toBeCloseTo(0.65, 3);
    expect(statsFor(build('strength', 1)).recoverTime).toBeCloseTo(1.167, 3);
    expect(statsFor(build('strength', 10)).recoverTime).toBeCloseTo(0.467, 3);
    expect(statsFor(build('dribbling', 1)).turnSlowdown).toBeCloseTo(0.5, 3);
    expect(statsFor(build('dribbling', 1)).dribbleSpeed).toBeCloseTo(0.88, 3);
    expect(statsFor(build('dribbling', 10)).dribbleSpeed).toBeCloseTo(0.97, 3);
    expect(statsFor(build('dribbling', 10)).agility).toBeCloseTo(1.4, 3);
    expect(statsFor(build('dribbling', 1)).agility).toBeCloseTo(0.68, 3);
    expect(statsFor(build('pace', 10)).sprintTouch).toBeCloseTo(0.35, 3);
    expect(1 / statsFor(build('pace', 10)).drain).toBeCloseTo(2.4, 2);
    expect(1 / statsFor(build('pace', 1)).drain).toBeCloseTo(3.75, 2);
    expect(statsFor(build('pace', 5)).sprintTouch).toBe(0);
  });

  it('Dribbling turns a sprint round sooner, without speeding up a straight start', () => {
    // Ticks from standing to 3 m, and from a full sprint one way to half
    // speed the other.
    const run = (dribbling: number) => {
      const match = createMatch([createPlayer('me', 'gold', build('dribbling', dribbling))]);
      match.kickoffHeld = false;
      // Without the ball: that's what Dribbling's speed with it is for.
      match.owner = null;
      Object.assign(match.ball, { x: 10, y: -5 });
      const me = match.players[0]!;
      Object.assign(me, { x: -14, y: 5, vx: 0, vy: 0, fx: 1, fy: 0 });
      let start = 0;
      while (me.x + 14 < 3 && start < 600) {
        step(match, { me: { x: 1, y: 0, kick: false, sprint: true } });
        start++;
      }
      Object.assign(me, { x: -10, vx: me.stats.sprintSpeed, vy: 0 });
      let turn = 0;
      while (me.vx > -me.stats.sprintSpeed / 2 && turn < 600) {
        step(match, { me: { x: -1, y: 0, kick: false, sprint: true } });
        turn++;
      }
      return { start, turn };
    };
    const [nimble, even, stiff] = [run(10), run(5), run(1)];
    expect(nimble.start).toBe(even.start);
    expect(stiff.start).toBe(even.start);
    expect(nimble.turn).toBeLessThan(even.turn);
    expect(even.turn).toBeLessThan(stiff.turn);
  });

  it('Pace 10 outruns Pace 1', () => {
    const match = createMatch([createPlayer('fast', 'gold', build('pace', 10)), createPlayer('slow', 'gold', build('pace', 1))]);
    const [fast, slow] = match.players;
    Object.assign(fast!, { x: -8, y: -6 });
    Object.assign(slow!, { x: -12, y: -6 });
    run(match, ticks(1), { fast: { y: 1, sprint: true }, slow: { y: 1, sprint: true } });
    expect(fast!.y + 6).toBeGreaterThan((slow!.y + 6) * 1.3);
  });

  it('Power 10 shoots harder than Power 1', () => {
    const shot = (power: number) => {
      const match = createMatch([createPlayer('me', 'gold', build('power', power)), createPlayer('them', 'red')], { kickoff: 'gold' });
      run(match, ticks(1), { me: { kick: true } });
      run(match, 1, { me: { kick: false } });
      return Math.hypot(match.ball.vx, match.ball.vy);
    };
    expect(shot(10)).toBeGreaterThan(shot(1) * 1.3);
  });

  it('Tackling 10 pokes from further than Tackling 5', () => {
    const press = (tackling: number) => {
      const match = createMatch([createPlayer('me', 'gold', build('tackling', tackling)), createPlayer('them', 'red')]);
      match.owner = null;
      const [me] = match.players;
      // The ball 0.66m away, edge to edge: past a 5's poke range, inside a 10's.
      Object.assign(me!, { x: -0.66 - me!.r - match.ball.r, y: 0, fx: 1, fy: 0 });
      Object.assign(match.players[1]!, { x: 6, y: 6 });
      run(match, 1, { me: { kick: true } });
      return me!.action;
    };
    expect(press(10)).toBe('poke');
    expect(press(5)).toBe('slide');
  });

  it('dribblers ride some tackles, more the stronger they are', () => {
    // Pokes from up close, side on, over many seeded matches: the share won.
    const winRate = (tackling: number, strength: number, dribbling = 5) => {
      let won = 0;
      const tries = 60;
      for (let seed = 1; seed <= tries; seed++) {
        const match = createMatch([
          createPlayer('me', 'gold', { ...evenAttributes(), tackling }),
          createPlayer('them', 'red', { ...evenAttributes(), strength, dribbling }),
        ], { seed });
        const [me, them] = match.players;
        const by = CONFIG.dribble.distance;
        Object.assign(them!, { x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 1 });
        Object.assign(match.ball, { x: 0, y: by, vx: 0, vy: 0 });
        match.owner = 'them';
        Object.assign(me!, { x: -1.2, y: by, vx: 0, vy: 0, fx: 1, fy: 0 });
        run(match, 1, { me: { kick: true }, them: {} });
        run(match, ticks(0.3), { me: {}, them: {} });
        if (match.owner !== 'them') won++;
      }
      return won / tries;
    };
    // Level: about 85%.
    expect(winRate(5, 5)).toBeGreaterThan(0.7);
    expect(winRate(5, 5)).toBeLessThan(0.97);
    expect(winRate(5, 1)).toBe(1);
    // 0.85 × (1 / 1.3)³: about 39%.
    expect(winRate(5, 10)).toBeGreaterThan(0.3);
    expect(winRate(5, 10)).toBeLessThan(0.68);
    expect(winRate(10, 5)).toBe(1);
    // Dribbling counts the same as Strength.
    expect(winRate(5, 5, 1)).toBe(1);
    expect(winRate(5, 5, 10)).toBeLessThan(0.68);
  });
});
