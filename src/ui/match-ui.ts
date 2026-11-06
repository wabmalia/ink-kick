import { TEAM_NAME, type GoalRecord, type SimEvent, type Team } from '../engine/sim';
import { clockText } from '../game/rules';
import { paintNow } from './wash';
import { $ } from './dom';

// What a match shows on top of the pitch: the goal banner, its letters
// splashing in one after another with the scorer under them, and the
// scoreboard once the match is won.

export type Role = 'solo' | 'host' | 'guest';
export type NameOf = (id: string) => string | null;

const banner = $('banner');
const word = $('goal-word');
const by = $('goal-by');
const board = $('scoreboard');

// How long the last goal's banner stays up before the scoreboard comes in.
const BOARD_DELAY = 1700;
let boardTimer: ReturnType<typeof setTimeout> | undefined;

function scorerLine(goal: Pick<GoalRecord, 'scorer' | 'own'>, nameOf: NameOf) {
  const name = goal.scorer ? nameOf(goal.scorer) : null;
  if (!name) return '';
  return goal.own ? `Own goal · ${name}` : name;
}

// Each letter's paint: the scoring team's first, then the rest of the box.
const LETTER_PAINTS: Record<Team, string[]> = {
  gold: ['gold', 'blue', 'red', 'green', 'purple'],
  red: ['red', 'green', 'gold', 'purple', 'blue'],
};

function showGoal(goal: GoalRecord, nameOf: NameOf) {
  // Each letter its own splash of paint, a different colour each, tipped a
  // little this way or that, popping in one after another. The splashes
  // overlap, so they're a row of their own under the letters: drawn with
  // the letters, the next letter's splash would cover the last one's edge.
  const row = (blots: boolean) => {
    const r = document.createElement('div');
    r.className = blots ? 'goal-row goal-blots' : 'goal-row';
    if (blots) r.setAttribute('aria-hidden', 'true');
    r.append(...[...'GOAL!'].map((ch, i) => {
      const letter = document.createElement('span');
      letter.className = 'goal-letter';
      if (blots) letter.dataset.wash = LETTER_PAINTS[goal.team][i]!;
      letter.textContent = ch;
      letter.style.setProperty('--i', String(i));
      letter.style.setProperty('--tilt', `${[-7, 4, -3, 6, -5][i]}deg`);
      return letter;
    }));
    return r;
  };
  const blots = row(true);
  word.replaceChildren(blots, row(false));
  by.textContent = scorerLine(goal, nameOf);
  banner.className = `banner ${goal.team}`;
  for (const letter of blots.children) paintNow(letter as HTMLElement);
  // Restart the animation even if a banner was already up.
  void banner.offsetWidth;
  banner.classList.add('show');
}

export function hideGoal() {
  banner.className = 'banner';
}

function showBoard(end: Extract<SimEvent, { type: 'end' }>, nameOf: NameOf, role: Role) {
  const title = $('scoreboard-title');
  title.textContent = end.winner ? `${TEAM_NAME[end.winner]} wins!` : 'A draw';
  board.className = `card scoreboard ${end.winner ?? ''}`;
  $('scoreboard-final').textContent = `${end.score.gold} - ${end.score.red}`;
  // A line a scorer, on the side of the team their goals counted for (so
  // own goals sit on the other side from their own team), with the time of
  // each underneath. In the order they first scored.
  const span = (cls: string, text: string) => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  };
  const scorers = new Map<string, { team: Team; name: string; own: boolean; times: number[] }>();
  for (const goal of end.goals) {
    const key = `${goal.team}|${goal.scorer ?? ''}|${goal.own}`;
    const name = (goal.scorer && nameOf(goal.scorer)) || TEAM_NAME[goal.team];
    const s = scorers.get(key) ?? { team: goal.team, name, own: goal.own, times: [] };
    s.times.push(goal.at);
    scorers.set(key, s);
  }
  const column = (team: Team) => {
    const ul = document.createElement('ul');
    ul.className = `scorers ${team}`;
    for (const s of scorers.values()) {
      if (s.team !== team) continue;
      const li = document.createElement('li');
      // An own goal's scorer keeps their own team's colour.
      if (s.own) li.className = `by-${team === 'gold' ? 'red' : 'gold'}`;
      const who = span('who', s.name);
      if (s.own) who.append(span('own', ' (own goal)'));
      li.append(who, span('times', s.times.map(clockText).join(' · ')));
      ul.append(li);
    }
    return ul;
  };
  if (end.goals.length) $('goal-list').replaceChildren(column('gold'), column('red'));
  else $('goal-list').replaceChildren(span('none', 'No goals'));
  $('scoreboard-menu').hidden = role !== 'solo';
  $('play-again').hidden = role !== 'solo';
  $('scoreboard-lobby').hidden = role !== 'host';
  $('scoreboard-waiting').hidden = role !== 'guest';
  board.hidden = false;
  paintNow(board);
}

export function hideBoard() {
  clearTimeout(boardTimer);
  board.hidden = true;
}

/** Shows what this frame's events call for. */
export function matchEvents(events: SimEvent[], nameOf: NameOf, role: Role) {
  for (const e of events) {
    if (e.type === 'goal') showGoal(e, nameOf);
    else if (e.type === 'kickoff') hideGoal();
    else if (e.type === 'end') {
      clearTimeout(boardTimer);
      boardTimer = setTimeout(() => {
        hideGoal();
        showBoard(e, nameOf, role);
      }, BOARD_DELAY);
    }
  }
}

/** A fresh match, or leaving one: nothing from the last one stays up. */
export function resetMatchUi() {
  hideGoal();
  hideBoard();
}
