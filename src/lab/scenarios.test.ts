import { describe, expect, it } from 'vitest';
import { evenAttributes } from '../game/attributes';
import { arena, defaultAttrs, range, slalom, track } from './scenarios';

const finish = (run: ReturnType<typeof track.start>) => {
  let n = 0;
  while (!run.done && n++ < 10000) run.step();
  return run;
};

describe('lab scenarios', () => {
  it('Track: more Pace covers more ground', () => {
    const attrs = { a: { ...evenAttributes(), pace: 10 }, b: evenAttributes() };
    const run = finish(track.start(attrs, { length: '5', sprint: 'sprint' }, 1));
    const [a, b] = run.match.players;
    expect(Math.abs(a!.x)).toBeGreaterThan(0);
    expect(run.readout()[0]!.rows.find(r => r.label === 'Ahead')!.value).toMatch(/^Runner A by/);
    void b;
  });

  it('Arena: a slide from behind is penalized every time', () => {
    const [runs] = arena.repeat!(defaultAttrs(arena), { from: '180', kind: 'slide', move: 'run' }, 10);
    expect(runs!.rows).toContainEqual(expect.objectContaining({ label: 'Won, penalized', value: '100%' }));
  });

  it('Arena: a ridden slide from the front is hopped, not pushed along', () => {
    const attrs = { dribbler: { ...evenAttributes(), strength: 10, dribbling: 10 }, tackler: { ...evenAttributes(), tackling: 1 } };
    for (let seed = 1; seed <= 20; seed++) {
      const run = arena.start(attrs, { from: '0', kind: 'slide', move: 'run' }, seed);
      const tackler = run.match.players[1]!;
      let ridden = false;
      let pushed = false;
      while (!run.done) {
        if (run.step().some(e => e.type === 'shrug')) ridden = true;
        // Sliding towards the dribbler, never carried back the other way.
        if (ridden && tackler.action === 'slide' && tackler.vx > 0.5) pushed = true;
      }
      if (!ridden) continue;
      expect(pushed).toBe(false);
      return;
    }
    throw new Error('no ridden slide in 20 seeds');
  });

  it('Arena: a weak tackler from the front is often ridden by a strong dribbler', () => {
    const attrs = { dribbler: { ...evenAttributes(), strength: 10, dribbling: 10 }, tackler: { ...evenAttributes(), tackling: 1 } };
    const [runs] = arena.repeat!(attrs, { from: '0', kind: 'slide', move: 'run' }, 20);
    expect(runs!.rows.map(r => r.label)).toContain('Ridden');
  });

  it('Slalom: both dribblers get through, turn and finish; Dribbling 10 wins at a sprint', () => {
    const attrs = { a: { ...evenAttributes(), dribbling: 10 }, b: { ...evenAttributes(), pace: 10, dribbling: 1 } };
    const run = finish(slalom.start(attrs, { spacing: '3.5', pace: 'sprint', ball: 'with' }, 1));
    expect(run.t).toBeLessThan(20);
    const quicker = run.readout()[0]!.rows.find(r => r.label === 'Quicker')!.value;
    expect(quicker).toMatch(/^A by/);
  });

  it('Shooting: every shot gets a result, and Power 10 scores more from range', () => {
    const attrs = { a: { ...evenAttributes(), power: 10 }, b: { ...evenAttributes(), power: 1 } };
    const opts = { ...range.defaults, spot: '-5,0' };
    const run = finish(range.start(attrs, opts, 1));
    for (const section of run.readout().slice(1)) expect(section.rows[0]!.value).not.toMatch(/^(-|waiting)$/);
    const goals = range.repeat!(attrs, opts, 20).map(sec => Number(sec.rows.find(r => r.label === 'Goal')?.value.replace('%', '') ?? 0));
    expect(goals[0]!).toBeGreaterThan(goals[1]!);
  });

  it('Shooting: left curl bends to the shooter\'s left as seen on screen (up it, shooting right)', () => {
    const endY = (curl: string) => {
      const r = range.start(defaultAttrs(range), { ...range.defaults, curl, keeper: 'off', spot: '0,0', target: '15,0' }, 1);
      for (let i = 0; i < 200; i++) r.step();
      return r.match.ball.y;
    };
    expect(endY('left-full')).toBeLessThan(0);
    expect(endY('right-full')).toBeGreaterThan(0);
  });

  it('Slalom: through tight cones at a run, Dribbling 10 beats Pace 10 (Pace needs a straight run)', () => {
    const attrs = { a: { ...evenAttributes(), pace: 10 }, b: { ...evenAttributes(), dribbling: 10 } };
    const run = finish(slalom.start(attrs, { spacing: '2.5', pace: 'run', ball: 'with' }, 1));
    expect(run.readout()[0]!.rows.find(r => r.label === 'Quicker')!.value).toMatch(/^B by/);
  });
});
