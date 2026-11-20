import { describe, expect, it } from 'vitest';
import type { TrainingStats } from '../game/training';
import { drillRows, trainLine } from './drill-rows';

const fresh = (): TrainingStats => ({
  lanes: [
    { name: 'Sprint', running: null, last: null, best: { with: null, without: null } },
    { name: 'Cones', running: null, last: null, best: { with: null, without: null } },
  ],
  duel: { challenges: 0, lost: 0, held: null, best: null },
  tackle: { pokes: 0, pokesWon: 0, slides: 0, slidesWon: 0 },
  keeper: { shots: 0, goals: 0, saves: 0 },
});

describe('trainLine', () => {
  it('shows nothing until a drill is touched', () => {
    const rows = drillRows(fresh());
    expect(trainLine(null, rows, null)).toEqual({ index: null, record: false });
    expect(trainLine(rows, drillRows(fresh()), null)).toEqual({ index: null, record: false });
  });

  it('follows the drill whose numbers changed last', () => {
    const a = fresh();
    const before = drillRows(a);
    a.tackle.pokes = 1;
    const tackled = drillRows(a);
    expect(trainLine(before, tackled, null).index).toBe(3);
    a.lanes[0]!.running = 1.2;
    const running = drillRows(a);
    expect(trainLine(tackled, running, 3).index).toBe(0);
    // Nothing new: the line stays where it was.
    expect(trainLine(running, drillRows(a), 0).index).toBe(0);
  });

  it('flags a new best, not every run', () => {
    const a = fresh();
    a.lanes[0]!.last = { time: 3.4, withBall: false };
    a.lanes[0]!.best.without = 3.4;
    const first = drillRows(a);
    a.lanes[0]!.last = { time: 3.1, withBall: false };
    a.lanes[0]!.best.without = 3.1;
    const better = drillRows(a);
    expect(trainLine(first, better, 0)).toEqual({ index: 0, record: true });
    a.lanes[0]!.last = { time: 3.6, withBall: false };
    expect(trainLine(better, drillRows(a), 0)).toEqual({ index: 0, record: false });
  });

  it('keeps the phone line short', () => {
    const a = fresh();
    a.lanes[1]!.last = { time: 5.25, withBall: true };
    a.lanes[1]!.best = { with: 5.25, without: 4.9 };
    const cones = drillRows(a)[1]!;
    expect(cones.short).toBe('best 5.25 s');
  });
});
