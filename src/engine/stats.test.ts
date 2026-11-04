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
    expect(statsFor(build('tackling', 1)).pokeRange).toBeCloseTo(0.756, 3);
    expect(statsFor(build('strength', 10)).loseDistance).toBeCloseTo(0.6, 3);
    expect(statsFor(build('dribbling', 1)).turnSlowdown).toBeCloseTo(0.583, 3);
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
      // The ball 1m away, edge to edge: past a 5's poke range, inside a 10's.
      Object.assign(me!, { x: -1 - me!.r - match.ball.r, y: 0, fx: 1, fy: 0 });
      Object.assign(match.players[1]!, { x: 6, y: 6 });
      run(match, 1, { me: { kick: true } });
      return me!.action;
    };
    expect(press(10)).toBe('poke');
    expect(press(5)).toBe('slide');
  });
});
