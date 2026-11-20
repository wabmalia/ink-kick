import type { TrainingStats } from '../game/training';
import { drillRows, rowKey, trainLine, type DrillRow } from './drill-rows';

// The training ground's times card: each lane's clock, last run and bests
// with and without the ball; the duel box's challenges shrugged off; the
// tackles won off the dummy; and the shots that beat the keeper.
// On phones the card folds away and one line at the top shows the drill
// you touched last (see trainLine).

const list = document.getElementById('train-times')!;
const line = document.getElementById('train-line')!;
let shown = '';
let lastRows: DrillRow[] | null = null;
let lineIndex: number | null = null;

const IDLE = 'Pick a drill to start';

function span(className: string, text: string) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/** Back to the idle line, for a fresh visit to the training ground. */
export function resetTimes() {
  lastRows = null;
  lineIndex = null;
  shown = '';
}

export function showTimes(stats: TrainingStats) {
  const rows = drillRows(stats);
  // Only touch the page when something changed.
  const key = rows.map(rowKey).join('|');
  if (key === shown) return;
  shown = key;
  const pick = trainLine(lastRows, rows, lineIndex);
  lastRows = rows;
  lineIndex = pick.index;

  list.replaceChildren(...rows.flatMap(r => {
    const dt = document.createElement('dt');
    dt.textContent = `${r.drill} · ${r.test}`;
    const dd = document.createElement('dd');
    dd.append(span('now', r.now), span('best', r.best));
    return [dt, dd];
  }));

  const r = lineIndex === null ? null : rows[lineIndex]!;
  if (!r) {
    line.replaceChildren(span('best', IDLE));
  } else {
    line.replaceChildren(span('drill', r.drill), span('now', r.now), ...(r.short ? [span('best', r.short)] : []));
  }
  if (pick.record) {
    // Restarting the animation: off, a reflow, then on.
    line.classList.remove('record');
    void line.offsetWidth;
    line.classList.add('record');
  }
}
