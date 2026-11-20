import type { Input } from '../engine/sim';

// Touch screens: a stick on the left to run (and curl after a kick), Kick
// and Sprint buttons at the bottom right. Shown only where the main pointer
// is a finger, and only while a match takes input (see enableTouch).
//
// The stick floats: a thumb put down anywhere on the left side becomes its
// centre, so it sits wherever suits the hand, and lifting and putting the
// thumb back down mid-play still steers. Let go and it returns to its spot.
//
// A fake, as Space then Shift on a keyboard: flick the kick finger onto
// Sprint while charging. The kick is called off and you sprint away. Only a
// quick flick counts, so a thumb drifting onto Sprint still strikes.

/** Drags shorter than this share of the stick's reach don't move you. */
export const DEAD_ZONE = 0.22;
/** The stick's reach, from its centre to its rim, in CSS px. */
export const STICK_REACH = 48;
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

/** Where the stick's centre goes for a thumb put down at (x, y): there,
 *  unless that would push the stick off the screen's edge. */
export function stickCentre(x: number, y: number, width: number, height: number, reach = STICK_REACH): { x: number; y: number } {
  const margin = reach + 6;
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, width - margin)),
    y: Math.min(Math.max(y, margin), Math.max(margin, height - margin)),
  };
}

const state = { x: 0, y: 0, kick: false, sprint: false };
let enabled = false;
let root: HTMLElement | null = null;
const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
let releaseAll = () => {};

function build(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'touch-controls';
  el.hidden = true;
  el.innerHTML = `
    <div class="touch-zone" aria-hidden="true">
      <div class="touch-stick"><div class="touch-knob"></div></div>
    </div>
    <button class="touch-btn touch-sprint" type="button" tabindex="-1">Sprint</button>
    <button class="touch-btn touch-kick" type="button" tabindex="-1">Kick</button>`;
  document.body.append(el);

  const zone = el.querySelector<HTMLElement>('.touch-zone')!;
  const stick = el.querySelector<HTMLElement>('.touch-stick')!;
  const knob = el.querySelector<HTMLElement>('.touch-knob')!;
  const kickBtn = el.querySelector<HTMLElement>('.touch-kick')!;
  const sprintBtn = el.querySelector<HTMLElement>('.touch-sprint')!;

  // The stick: centred where the thumb lands.
  let stickPointer: number | null = null;
  let centre = { x: 0, y: 0 };
  const steer = (e: PointerEvent) => {
    const dx = e.clientX - centre.x;
    const dy = e.clientY - centre.y;
    const dir = stickDirection(dx, dy, STICK_REACH);
    state.x = dir.x;
    state.y = dir.y;
    // The knob follows the thumb, up to the rim.
    const len = Math.hypot(dx, dy);
    const k = len > STICK_REACH ? STICK_REACH / len : 1;
    knob.style.translate = `${dx * k}px ${dy * k}px`;
  };
  const restStick = () => {
    stickPointer = null;
    state.x = 0;
    state.y = 0;
    knob.style.translate = '';
    stick.style.left = '';
    stick.style.top = '';
    stick.classList.remove('held');
  };
  zone.addEventListener('pointerdown', e => {
    if (stickPointer !== null) return;
    e.preventDefault();
    stickPointer = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    centre = stickCentre(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
    const box = zone.getBoundingClientRect();
    stick.style.left = `${centre.x - box.left}px`;
    stick.style.top = `${centre.y - box.top}px`;
    stick.classList.add('held');
    steer(e);
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId === stickPointer) steer(e);
  });
  const stickUp = (e: PointerEvent) => {
    if (e.pointerId === stickPointer) restStick();
  };
  zone.addEventListener('pointerup', stickUp);
  zone.addEventListener('pointercancel', stickUp);

  // Sprint: held while a finger is on it.
  let sprintPointer: number | null = null;
  sprintBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    sprintPointer = e.pointerId;
    sprintBtn.setPointerCapture(e.pointerId);
    state.sprint = true;
    sprintBtn.classList.add('held');
  });
  const sprintUp = (e: PointerEvent) => {
    if (e.pointerId !== sprintPointer) return;
    sprintPointer = null;
    state.sprint = false;
    sprintBtn.classList.remove('held');
  };
  sprintBtn.addEventListener('pointerup', sprintUp);
  sprintBtn.addEventListener('pointercancel', sprintUp);

  // Kick: held while a finger is on it, unless that finger flicks onto
  // Sprint, which turns it into a sprinting finger until it lifts.
  let kickPointer: number | null = null;
  let faked = false;
  let samples: Sample[] = [];
  const onSprint = (x: number, y: number) => {
    const r = sprintBtn.getBoundingClientRect();
    const pad = 10;
    return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  };
  kickBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    kickPointer = e.pointerId;
    faked = false;
    samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    kickBtn.setPointerCapture(e.pointerId);
    state.kick = true;
    kickBtn.classList.add('held');
  });
  kickBtn.addEventListener('pointermove', e => {
    if (e.pointerId !== kickPointer || faked) return;
    samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    while (samples.length > 2 && e.timeStamp - samples[0]!.t > FLICK_WINDOW * 2) samples.shift();
    if (!onSprint(e.clientX, e.clientY) || fingerSpeed(samples) < FLICK_SPEED) return;
    // Both in the same tick: the sim sees Sprint go down mid-charge first.
    faked = true;
    state.kick = false;
    state.sprint = true;
    kickBtn.classList.remove('held');
    sprintBtn.classList.add('held');
  });
  const kickUp = (e: PointerEvent) => {
    if (e.pointerId !== kickPointer) return;
    kickPointer = null;
    state.kick = false;
    kickBtn.classList.remove('held');
    if (faked && sprintPointer === null) {
      state.sprint = false;
      sprintBtn.classList.remove('held');
    }
    faked = false;
  };
  kickBtn.addEventListener('pointerup', kickUp);
  kickBtn.addEventListener('pointercancel', kickUp);

  releaseAll = () => {
    restStick();
    kickPointer = null;
    sprintPointer = null;
    faked = false;
    state.kick = false;
    state.sprint = false;
    kickBtn.classList.remove('held');
    sprintBtn.classList.remove('held');
  };
  // No long-press menus or text selection under a thumb.
  el.addEventListener('contextmenu', e => e.preventDefault());
  return el;
}

function show() {
  const on = enabled && !!coarse?.matches;
  if (on && !root) root = build();
  if (!root) return;
  if (root.hidden === on) root.hidden = !on;
  if (!on) releaseAll();
}

coarse?.addEventListener('change', show);
if (typeof window !== 'undefined') window.addEventListener('blur', () => releaseAll());

export function enableTouch(on: boolean) {
  if (enabled === on) return;
  enabled = on;
  show();
}

export function touchInput(): Input {
  return { ...state };
}
