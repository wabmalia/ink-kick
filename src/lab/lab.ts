import '../style.css';
import './lab.css';
import { ATTRIBUTES, LABELS, MAX, MIN, type Attributes } from '../game/attributes';
import { Playback } from './playback';
import { GameView } from '../game/view';
import type { SimEvent } from '../engine/sim';
import { paintMenu } from '../ui/wash';
import { CONFIG } from '../config';
import { defaultAttrs, SCENARIOS, type Options, type Run, type Scenario, type Section } from './scenarios';

// The lab (hidden, at #/lab): pick a scenario, set each player's attributes and the
// scenario's options, and watch it play out on the real pitch and sim, as
// slowly as you like. Attributes aren't capped at 30 here, so extremes can
// be tried against each other.

const view = new GameView(document.getElementById('game')!);
const panel = document.getElementById('lab')!;
const outPanel = document.getElementById('lab-out')!;

let scenario: Scenario = SCENARIOS[0]!;
// Kept per scenario, so switching back finds the values where they were.
const attrsFor = new Map<string, Record<string, Attributes>>();
const optsFor = new Map<string, Options>();
let seed = 1;
let speed = 1;
let playing = true;
let run: Run;
let local: Playback;
let names = new Map<string, string>();

const attrs = () => attrsFor.get(scenario.id) ?? attrsFor.set(scenario.id, defaultAttrs(scenario)).get(scenario.id)!;
const opts = () => optsFor.get(scenario.id) ?? optsFor.set(scenario.id, { ...scenario.defaults }).get(scenario.id)!;

function restart() {
  run = scenario.start(attrs(), opts(), seed);
  local = new Playback(run);
  names = new Map(scenario.roles.map(r => [r.id, r.label]));
  view.clearEffects();
  playing = true;
  repeatOut.replaceChildren();
  showPlaying();
}

// --- The panel -------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

function button(text: string, onClick: () => void, cls = '') {
  const b = el('button', { type: 'button', className: `lab-btn ${cls}`, textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

const tabs = el('div', { className: 'lab-tabs' });
const choices = el('div', { className: 'lab-choices' });
const roles = el('div', { className: 'lab-roles' });
const playBtn = button('Pause', () => {
  if (run.done) restart();
  else playing = !playing;
  showPlaying();
});
const speeds = el('div', { className: 'lab-speeds' });
const repeatBtn = button('Run 50', () => {
  repeatOut.replaceChildren(el('p', { className: 'lab-note', textContent: 'Running…' }));
  // Let the page show that before the runs take the thread.
  setTimeout(() => repeatOut.replaceChildren(...scenario.repeat!(attrs(), opts(), 50).map(table)), 20);
});
const repeatOut = el('div', { className: 'lab-readout' });
const readout = el('div', { className: 'lab-readout' });
let shown = '';

// A section of the readout as a little table: what, the value picked out,
// and tags for the attributes behind it.
function table(section: Section) {
  const t = el('table', { className: `lab-table ${section.team ?? ''}` }, el('caption', { textContent: section.title }));
  for (const r of section.rows) {
    t.append(el('tr', {},
      el('th', { scope: 'row', textContent: r.label }),
      el('td', { className: 'lab-value', textContent: r.value }),
      el('td', { className: 'lab-tags' }, ...(r.attrs ?? []).map(a => el('span', { className: `lab-tag ${a}`, textContent: LABELS[a] }))),
    ));
  }
  return t;
}

function showReadout(sections: Section[]) {
  const key = JSON.stringify(sections);
  if (key === shown) return;
  shown = key;
  readout.replaceChildren(...sections.map(table));
}

function showPlaying() {
  playBtn.textContent = run.done ? 'Again' : playing ? 'Pause' : 'Play';
}

function build() {
  tabs.replaceChildren(...SCENARIOS.map(sc => {
    const b = button(sc.name, () => {
      scenario = sc;
      build();
      restart();
    }, sc === scenario ? 'on' : '');
    b.setAttribute('aria-pressed', String(sc === scenario));
    return b;
  }));

  choices.replaceChildren(...scenario.choices.map(c => {
    const select = document.createElement('select');
    select.append(...c.options.map(o => new Option(o.label, o.value)));
    select.value = opts()[c.key]!;
    select.addEventListener('change', () => {
      opts()[c.key] = select.value;
      restart();
    });
    return el('label', { className: 'lab-choice' }, el('span', { textContent: c.label }), select);
  }), ...(scenario.hint ? [el('p', { className: 'lab-hint', textContent: scenario.hint })] : []));

  roles.replaceChildren(...scenario.roles.map(role => {
    const values = attrs()[role.id]!;
    const rows = ATTRIBUTES.map(key => {
      const out = el('output', { textContent: String(values[key]) });
      const set = (v: number) => {
        values[key] = Math.max(MIN, Math.min(MAX, v));
        out.textContent = String(values[key]);
        restart();
      };
      return el('div', { className: 'lab-attr' },
        el('span', { textContent: LABELS[key] }),
        button('−', () => set(values[key] - 1), 'step'),
        out,
        button('+', () => set(values[key] + 1), 'step'),
      );
    });
    return el('section', { className: `lab-role ${role.team}` }, el('h3', { textContent: role.label }), ...rows);
  }));

  speeds.replaceChildren(el('span', { textContent: 'Speed' }), ...[0.25, 0.5, 1].map(v => {
    const b = button(`${v}×`, () => {
      speed = v;
      build();
    }, v === speed ? 'on' : '');
    return b;
  }));

  repeatBtn.hidden = !scenario.repeat;
  repeatOut.hidden = !scenario.repeat;
}

panel.append(
  el('h2', { textContent: 'Lab' }),
  tabs, choices, roles,
  el('div', { className: 'lab-controls' }, playBtn, button('Restart', restart), repeatBtn),
  speeds,
);
const clock = el('span', { className: 'lab-clock' });
outPanel.append(el('h2', {}, 'What happened', clock), el('div', { className: 'lab-blocks' }, readout, repeatOut));
build();
restart();

// --- Dragging the shot -----------------------------------------------------
// On the pitch: the ring moves the shot (the aim moves with it), the arrow's
// head turns and lengthens it. Played again from the new spot on letting go.

const game = document.getElementById('game')!;
const { width: W, height: H } = CONFIG.pitch;
let drag: { what: 'spot' | 'target'; from: { x: number; y: number }; spot: { x: number; y: number }; target: { x: number; y: number } } | null = null;

const at = (e: PointerEvent) => view.pickGround(e.clientX, e.clientY);
const pt = (v: string | undefined) => {
  const [x, y] = (v ?? '0,0').split(',').map(Number);
  return { x: x!, y: y! };
};
const fmt = (p: { x: number; y: number }) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
const clampTo = (p: { x: number; y: number }, mx: number, my: number) => ({
  x: Math.max(-mx, Math.min(mx, p.x)),
  y: Math.max(-my, Math.min(my, p.y)),
});

function handleAt(p: { x: number; y: number } | null) {
  const aim = run.aim;
  if (!aim || !p) return null;
  if (Math.hypot(p.x - aim.tx, p.y - aim.ty) < 0.8) return 'target';
  if (Math.hypot(p.x - aim.x, p.y - aim.y) < 1.1) return 'spot';
  return null;
}

game.addEventListener('pointerdown', e => {
  const p = at(e);
  const what = handleAt(p);
  if (!what || !p) return;
  const o = opts();
  drag = { what, from: p, spot: pt(o.spot), target: pt(o.target) };
  game.setPointerCapture(e.pointerId);
  game.style.cursor = 'grabbing';
  e.preventDefault();
});
game.addEventListener('pointermove', e => {
  const p = at(e);
  if (!drag) {
    game.style.cursor = handleAt(p) ? 'grab' : '';
    return;
  }
  if (!p) return;
  const o = opts();
  const dx = p.x - drag.from.x;
  const dy = p.y - drag.from.y;
  if (drag.what === 'spot') {
    const spot = clampTo({ x: drag.spot.x + dx, y: drag.spot.y + dy }, W / 2 - 0.8, H / 2 - 0.8);
    o.spot = fmt(spot);
    o.target = fmt({ x: drag.target.x + (spot.x - drag.spot.x), y: drag.target.y + (spot.y - drag.spot.y) });
  } else {
    o.target = fmt(clampTo({ x: drag.target.x + dx, y: drag.target.y + dy }, W / 2 + 1, H / 2));
  }
  // Shown standing in the new spot while dragging.
  restart();
  playing = false;
  showPlaying();
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  game.style.cursor = '';
  playing = true;
  showPlaying();
};
game.addEventListener('pointerup', endDrag);
game.addEventListener('pointercancel', endDrag);
paintMenu();

// --- The loop --------------------------------------------------------------

let last = performance.now();
let sinceReadout = 1;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let played: SimEvent[] = [];
  if (playing && !run.done) {
    played = local.advance(dt * speed);
    if (run.done) showPlaying();
  }
  view.play(played);
  view.render(local.state(), dt * (playing ? speed : 0), now, null, names);
  sinceReadout += dt;
  if (sinceReadout > 0.1) {
    sinceReadout = 0;
    showReadout(run.readout());
    clock.textContent = run.limit ? `${run.t.toFixed(1)} of ${run.limit}s` : `${run.t.toFixed(2)}s`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('pagehide', () => view.dispose());
