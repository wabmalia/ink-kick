import { DEFAULT_LAYOUT, moveButton, resizeButton, resizeStick, type Movable, type TouchLayout } from '../game/touch-layout';
import { setTouchLayout, touchArea, touchLayout } from '../game/touch';
import { openDialog } from './dom';

// The touch controls' editor, from How to play on a touch screen: copies of
// the stick, Kick and Sprint where they are now, each with a ring and a
// handle on its edge, as Sinkhole's editor sizes its holes. Drag a button to
// move it, its handle to resize it; the stick only resizes, since it centres
// on the thumb anyway. Done saves, Reset puts the usual layout back.
// It's a dialog, so solo and training wait while it's open; a room never
// stops for it (main.ts only pauses solo), the player just stands still.

const dialog = document.getElementById('controls-editor') as HTMLDialogElement;
const area = dialog.querySelector<HTMLElement>('.ce-area')!;
let draft: TouchLayout = { ...DEFAULT_LAYOUT };

type Part = Movable | 'stick';
const parts = new Map<Part, { el: HTMLElement; handle: HTMLElement }>();

function make(part: Part, label: string) {
  const el = document.createElement('div');
  el.className = `ce-part ce-${part}`;
  if (label) el.textContent = label;
  const handle = document.createElement('span');
  handle.className = 'ce-handle';
  handle.setAttribute('aria-hidden', 'true');
  el.append(handle);
  area.append(el);
  parts.set(part, { el, handle });
  return { el, handle };
}

/** The area's size, which the layout is measured in. */
const size = () => ({ w: area.clientWidth, h: area.clientHeight });

function draw() {
  for (const key of ['kick', 'sprint'] as const) {
    const s = draft[key];
    const { el } = parts.get(key)!;
    el.style.right = `${s.x - s.d / 2}px`;
    el.style.bottom = `${s.y - s.d / 2}px`;
    el.style.width = el.style.height = `${s.d}px`;
    el.style.fontSize = `${Math.round(s.d * (key === 'kick' ? 0.23 : 0.25))}px`;
  }
  const { el } = parts.get('stick')!;
  const d = draft.stick.d;
  el.style.left = '22px';
  el.style.bottom = '18px';
  el.style.width = el.style.height = `${d}px`;
}

/** A part's centre on screen, in client px. */
function centre(part: Part) {
  const r = parts.get(part)!.el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function drag(part: Part, what: 'move' | 'size', start: PointerEvent) {
  const target = start.currentTarget as HTMLElement;
  target.setPointerCapture(start.pointerId);
  parts.get(part)!.el.classList.add('active');
  const box = area.getBoundingClientRect();
  // Grabbed off-centre, a moved button keeps that offset under the finger.
  const c = centre(part);
  const grab = { x: start.clientX - c.x, y: start.clientY - c.y };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== start.pointerId) return;
    const { w, h } = size();
    if (what === 'size') {
      const now = centre(part);
      const d = 2 * Math.hypot(e.clientX - now.x, e.clientY - now.y);
      draft = part === 'stick' ? resizeStick(draft, d) : resizeButton(draft, part, d, w, h);
    } else if (part !== 'stick') {
      // From the area's bottom-right corner, to the button's centre.
      const x = box.right - (e.clientX - grab.x);
      const y = box.bottom - (e.clientY - grab.y);
      draft = moveButton(draft, part, x, y, w, h);
    }
    draw();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== start.pointerId) return;
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    parts.get(part)!.el.classList.remove('active');
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

export function mountControlsEditor() {
  const stick = make('stick', '');
  stick.el.append(Object.assign(document.createElement('span'), { className: 'ce-knob' }));
  const kick = make('kick', 'Kick');
  const sprint = make('sprint', 'Sprint');
  for (const [part, { el, handle }] of [['stick', stick], ['kick', kick], ['sprint', sprint]] as const) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      drag(part, 'size', e);
    });
    if (part !== 'stick') {
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        drag(part, 'move', e);
      });
    }
  }
  dialog.querySelector('#ce-reset')!.addEventListener('click', () => {
    draft = { ...DEFAULT_LAYOUT };
    draw();
  });
  dialog.querySelector('#ce-done')!.addEventListener('click', () => {
    setTouchLayout(draft);
    dialog.close();
  });
  // Esc or the back gesture closes it without saving.
  dialog.addEventListener('close', () => window.dispatchEvent(new Event('controls-editor')));
  for (const b of document.querySelectorAll('[data-controls-editor]')) {
    b.addEventListener('click', () => openControlsEditor());
  }
}

export function openControlsEditor() {
  (document.getElementById('help') as HTMLDialogElement | null)?.close();
  openDialog(dialog);
  // Measured in the area, now that it's on screen.
  draft = touchLayout(touchArea());
  draw();
  window.dispatchEvent(new Event('controls-editor'));
}
