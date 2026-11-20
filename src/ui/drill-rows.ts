import type { TrainingStats } from '../game/training';

// The training drills as text: the full card's rows and the phone line's
// pick of which drill to show. Kept apart from the page for testing.

// The attribute each lane is for.
const TESTS: Record<string, string> = { Sprint: 'Pace, Stamina', Cones: 'Dribbling' };

const secs = (t: number | null) => (t === null ? '–' : `${t.toFixed(2)} s`);

/** One drill as the card and the phone line show it. `record` is the best
 *  worth celebrating when it changes, if the drill has one. */
export interface DrillRow {
  drill: string;
  test: string;
  now: string;
  best: string;
  short: string;
  record: string | null;
}

export function drillRows(stats: TrainingStats): DrillRow[] {
  const rows: DrillRow[] = stats.lanes.map(l => {
    // On the line, the best of the same kind as the last run.
    const withBall = l.last?.withBall ?? false;
    const kindBest = withBall ? l.best.with : l.best.without;
    return {
      drill: l.name,
      test: TESTS[l.name] ?? '',
      now: l.running !== null ? `${secs(l.running)}…` : l.last ? `${secs(l.last.time)} ${l.last.withBall ? 'with ball' : 'no ball'}` : 'Cross a gate',
      best: `Best ${secs(l.best.without)} · with ball ${secs(l.best.with)}`,
      short: kindBest === null ? '' : `best ${secs(kindBest)}`,
      record: l.best.with === null && l.best.without === null ? null : `${l.best.without}|${l.best.with}`,
    };
  });
  const d = stats.duel;
  rows.push({
    drill: 'Duel',
    test: 'Strength',
    now: d.challenges ? `Shrugged off ${d.challenges - d.lost} of ${d.challenges}` : 'Bring a ball in, stand still',
    best: d.held !== null ? `Kept it ${secs(d.held)}` : `Longest kept ${secs(d.best)}`,
    short: d.held !== null ? `kept ${secs(d.held)}` : d.best === null ? '' : `longest ${secs(d.best)}`,
    record: d.best === null ? null : String(d.best),
  });
  const t = stats.tackle;
  const tries = t.pokes + t.slides;
  rows.push({
    drill: 'Tackle',
    test: 'Tackling',
    now: tries ? `Won ${t.pokesWon + t.slidesWon} of ${tries}` : 'Tackle the dummy',
    best: `Pokes ${t.pokesWon}/${t.pokes} · slides ${t.slidesWon}/${t.slides}`,
    short: tries ? `pokes ${t.pokesWon}/${t.pokes} · slides ${t.slidesWon}/${t.slides}` : '',
    record: null,
  });
  const k = stats.keeper;
  rows.push({
    drill: 'Keeper',
    test: 'Power',
    now: k.shots ? `Scored ${k.goals} of ${k.shots}` : 'Shoot past it',
    best: `Saved ${k.saves}`,
    short: k.shots ? `saved ${k.saves}` : '',
    record: null,
  });
  return rows;
}

export const rowKey = (r: DrillRow) => `${r.now}|${r.best}`;

/** Which drill to show on the line: the first whose numbers changed since
 *  last time, else the one already shown (null before any). And whether
 *  that change set a new best. */
export function trainLine(before: DrillRow[] | null, after: DrillRow[], shown: number | null): { index: number | null; record: boolean } {
  if (!before) return { index: shown, record: false };
  const i = after.findIndex((r, j) => before[j] && rowKey(r) !== rowKey(before[j]!));
  if (i < 0) return { index: shown, record: false };
  const was = before[i]!.record;
  const now = after[i]!.record;
  return { index: i, record: now !== null && now !== was };
}

