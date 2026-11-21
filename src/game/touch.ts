import type { Input } from '../engine/sim';
import { KEYS, store } from '../storage';
import { DEFAULT_LAYOUT, fitLayout, type TouchLayout } from './touch-layout';

// Touch screens: a stick on the left to run (and curl after a kick), Kick
// and Sprint buttons at the bottom right. Shown only where the main pointer
// is a finger, and only while a match takes input (see enableTouch).
//
// Each sits where the player put it, at the size they chose (the controls
// editor, game/touch-layout.ts). The stick steers from a touch on it, or
// just around it.
//
// Flicks between the buttons, without lifting the thumb: Kick onto Sprint
// mid-charge is the fake (as Space then Shift on a keyboard), Sprint onto
// Kick slides or starts a charge. Only a quick flick counts, so a thumb
// drifting onto the other button doesn't change anything.

/** Drags shorter than this share of the stick's reach don't move you. */
export const DEAD_ZONE = 0.22;
/** The stick's reach at its usual size, from its centre to its rim, in CSS px. */
export const STICK_REACH = 48;
/** Kick to Sprint, centre to centre, at the usual layout: the flick speed
 *  is for this distance, and scales with it. */
const FLICK_DISTANCE = Math.hypot(DEFAULT_LAYOUT.kick.x - DEFAULT_LAYOUT.sprint.x, DEFAULT_LAYOUT.kick.y - DEFAULT_LAYOUT.sprint.y);
/** A flick onto Sprint: at least this fast, in CSS px per ms... */
export const FLICK_SPEED = 0.45;
/** ...measured over about this long, in ms. */
export const FLICK_WINDOW = 90;

/** A drag from the stick's centre to a direction, in the sim's terms
 *  (x right, y down the screen). Zero inside the dead zone; the sim only
 *  uses the direction, so the length is capped at 1. */
export function stickDirection(dx: number, dy: number, reach: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (reach <= 0 || len < reach * DEAD_ZONE) return { x: 0, y: 0 };
  const k = 1 / Math.max(len, reach);
  return { x: dx * k, y: dy * k };
}

export interface Sample { x: number; y: number; t: number }

/** How fast a finger is moving, in px per ms, from its recent samples
 *  (oldest first), looking back about FLICK_WINDOW from the newest. */
export function fingerSpeed(samples: Sample[]): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  let from = samples[0]!;
  for (const s of samples) {
    if (last.t - s.t <= FLICK_WINDOW) {
      from = s;
      break;
    }
  }
  const dt = last.t - from.t;
  return dt > 0 ? Math.hypot(last.x - from.x, last.y - from.y) / dt : 0;
}

const state = { x: 0, y: 0, kick: false, sprint: false };
// Where the buttons are and how big, as the player set them.
let layout: TouchLayout = { ...DEFAULT_LAYOUT };
let reach = STICK_REACH;
let flickSpeed = FLICK_SPEED;
let enabled = false;
let root: HTMLElement | null = null;
const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
let releaseAll = () => {};

function build(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'touch-controls';
  el.hidden = true;
  el.innerHTML = `
    <div class="touch-stick" aria-hidden="true"><div class="touch-knob"></div></div>
    <button class="touch-btn touch-sprint" type="button" tabindex="-1">Sprint</button>
    <button class="touch-btn touch-kick" type="button" tabindex="-1">Kick</button>`;
  document.body.append(el);

  const stick = el.querySelector<HTMLElement>('.touch-stick')!;
  const knob = el.querySelector<HTMLElement>('.touch-knob')!;
  const kickBtn = el.querySelector<HTMLElement>('.touch-kick')!;
  const sprintBtn = el.querySelector<HTMLElement>('.touch-sprint')!;

  // The stick: steering from its centre, wherever the touch began on it.
  let stickPointer: number | null = null;
  const steer = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dir = stickDirection(dx, dy, reach);
    state.x = dir.x;
    state.y = dir.y;
    // The knob follows the thumb, up to the rim.
    const len = Math.hypot(dx, dy);
    const k = len > reach ? reach / len : 1;
    knob.style.translate = `${dx * k}px ${dy * k}px`;
  };
  const restStick = () => {
    stickPointer = null;
    state.x = 0;
    state.y = 0;
    knob.style.translate = '';
    stick.classList.remove('held');
  };
  stick.addEventListener('pointerdown', e => {
    if (stickPointer !== null) return;
    e.preventDefault();
    stickPointer = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    stick.classList.add('held');
    steer(e);
  });
  stick.addEventListener('pointermove', e => {
    if (e.pointerId === stickPointer) steer(e);
  });
  const stickUp = (e: PointerEvent) => {
    if (e.pointerId === stickPointer) restStick();
  };
  stick.addEventListener('pointerup', stickUp);
  stick.addEventListener('pointercancel', stickUp);

  // Kick and Sprint: each finger on them has a role, kick or sprint, and
  // each is held while any finger has its role. A quick flick onto the
  // other button swaps that finger's role, once a touch: Kick onto Sprint
  // is the fake (the charge is called off and you sprint away), Sprint
  // onto Kick slides or starts a charge without lifting the thumb. A slow
  // drift onto the other button doesn't count.
  type Role = 'kick' | 'sprint';
  const fingers = new Map<number, { role: Role; swapped: boolean; samples: Sample[] }>();
  const buttons: Record<Role, HTMLElement> = { kick: kickBtn, sprint: sprintBtn };
  const sync = () => {
    for (const role of ['kick', 'sprint'] as const) {
      const on = [...fingers.values()].some(f => f.role === role);
      state[role] = on;
      buttons[role].classList.toggle('held', on);
    }
  };
  const over = (el: HTMLElement, x: number, y: number) => {
    const r = el.getBoundingClientRect();
    const pad = 10;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  };
  for (const role of ['kick', 'sprint'] as const) {
    const el = buttons[role];
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      fingers.set(e.pointerId, { role, swapped: false, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] });
      sync();
    });
    el.addEventListener('pointermove', e => {
      const f = fingers.get(e.pointerId);
      if (!f || f.swapped) return;
      f.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      while (f.samples.length > 2 && e.timeStamp - f.samples[0]!.t > FLICK_WINDOW * 2) f.samples.shift();
      const to: Role = f.role === 'kick' ? 'sprint' : 'kick';
      if (!over(buttons[to], e.clientX, e.clientY) || fingerSpeed(f.samples) < flickSpeed) return;
      // Both change in the same tick: on a fake the sim sees Sprint go
      // down mid-charge first.
      f.role = to;
      f.swapped = true;
      sync();
    });
    const up = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      sync();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  releaseAll = () => {
    restStick();
    fingers.clear();
    sync();
  };
  // No long-press menus or text selection under a thumb.
  el.addEventListener('contextmenu', e => e.preventDefault());
  return el;
}

/** Puts the buttons where the layout says, sized to it. */
function place() {
  if (!root) return;
  for (const key of ['kick', 'sprint'] as const) {
    const el = root.querySelector<HTMLElement>(`.touch-${key}`)!;
    const s = layout[key];
    el.style.right = `calc(env(safe-area-inset-right) + ${s.x - s.d / 2}px)`;
    el.style.bottom = `calc(env(safe-area-inset-bottom) + ${s.y - s.d / 2}px)`;
    el.style.width = el.style.height = `${s.d}px`;
    el.style.fontSize = `${Math.round(s.d * (key === 'kick' ? 0.23 : 0.25))}px`;
  }
  const stick = root.querySelector<HTMLElement>('.touch-stick')!;
  const s = layout.stick;
  stick.style.left = `calc(env(safe-area-inset-left) + ${s.x - s.d / 2}px)`;
  stick.style.bottom = `calc(env(safe-area-inset-bottom) + ${s.y - s.d / 2}px)`;
  stick.style.width = stick.style.height = `${s.d}px`;
}

/** The screen inside its safe area (clear of a notch and rounded
 *  corners), which layouts are measured in. */
export function touchArea(): { w: number; h: number } {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.append(probe);
  const s = getComputedStyle(probe);
  const px = (v: string) => parseFloat(v) || 0;
  const area = { w: window.innerWidth - px(s.paddingLeft) - px(s.paddingRight), h: window.innerHeight - px(s.paddingTop) - px(s.paddingBottom) };
  probe.remove();
  return area;
}

/** The layout the player set, fitted to this screen. */
export function touchLayout(area = touchArea()): TouchLayout {
  return fitLayout(store.getJSON(localStorage, KEYS.touchLayout), area.w, area.h);
}

/** Takes up a new layout (the editor's), saving it unless told not to. */
export function setTouchLayout(next: TouchLayout, save = true) {
  layout = next;
  reach = next.stick.d / 2;
  const apart = Math.hypot(next.kick.x - next.sprint.x, next.kick.y - next.sprint.y);
  // Further apart, a flick has further to go in the same moment.
  flickSpeed = FLICK_SPEED * Math.min(2, Math.max(0.8, apart / FLICK_DISTANCE));
  if (save) store.setJSON(localStorage, KEYS.touchLayout, next);
  place();
}

function show() {
  const on = enabled && !!coarse?.matches;
  if (on && !root) {
    root = build();
    setTouchLayout(touchLayout(), false);
  }
  if (!root) return;
  if (root.hidden === on) root.hidden = !on;
  if (!on) releaseAll();
}

coarse?.addEventListener('change', show);
if (typeof window !== 'undefined') window.addEventListener('resize', () => root && setTouchLayout(touchLayout(), false));
if (typeof window !== 'undefined') window.addEventListener('blur', () => releaseAll());

export function enableTouch(on: boolean) {
  if (enabled === on) return;
  enabled = on;
  show();
}

export function touchInput(): Input {
  return { ...state };
}
