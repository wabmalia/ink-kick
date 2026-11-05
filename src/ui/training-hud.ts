import type { TrainingStats } from '../game/training';

// The training ground's times card: each lane's clock, last run and bests
// with and without the ball; the duel box's challenges shrugged off; the
// tackles won off the dummy; and the shots that beat the keeper.

const list = document.getElementById('train-times')!;
let shown = '';

// The attribute each lane is for.
const TESTS: Record<string, string> = { Sprint: 'Pace, Stamina', Cones: 'Dribbling' };

const secs = (t: number | null) => (t === null ? '–' : `${t.toFixed(2)} s`);

export function showTimes(stats: TrainingStats) {
  const rows: [string, string, string][] = stats.lanes.map(l => [
    `${l.name} · ${TESTS[l.name] ?? ''}`,
    l.running !== null ? `${secs(l.running)}…` : l.last ? `${secs(l.last.time)} ${l.last.withBall ? 'with ball' : 'no ball'}` : 'Cross a gate',
    `Best ${secs(l.best.without)} · with ball ${secs(l.best.with)}`,
  ]);
  const d = stats.duel;
  rows.push([
    'Duel · Strength',
    d.challenges ? `Shrugged off ${d.challenges - d.lost} of ${d.challenges}` : 'Bring a ball in, stand still',
    d.held !== null ? `Kept it ${secs(d.held)}` : `Longest kept ${secs(d.best)}`,
  ]);
  const t = stats.tackle;
  const tries = t.pokes + t.slides;
  rows.push([
    'Tackle · Tackling',
    tries ? `Won ${t.pokesWon + t.slidesWon} of ${tries}` : 'Tackle the dummy',
    `Pokes ${t.pokesWon}/${t.pokes} · slides ${t.slidesWon}/${t.slides}`,
  ]);
  const k = stats.keeper;
  rows.push([
    'Keeper · Power',
    k.shots ? `Scored ${k.goals} of ${k.shots}` : 'Shoot past it',
    `Saved ${k.shots - k.goals}`,
  ]);
  // Only touch the page when something changed.
  const key = rows.flat().join('|');
  if (key === shown) return;
  shown = key;
  list.replaceChildren(...rows.flatMap(([name, now, best]) => {
    const dt = document.createElement('dt');
    dt.textContent = name;
    const dd = document.createElement('dd');
    const a = document.createElement('span');
    a.className = 'now';
    a.textContent = now;
    const b = document.createElement('span');
    b.className = 'best';
    b.textContent = best;
    dd.append(a, b);
    return [dt, dd];
  }));
}
