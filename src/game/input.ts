import type { Input } from '../engine/sim';
import { enableTouch, touchInput } from './touch';

// Keyboard: arrows or WASD to run, Shift to sprint, Space or X to kick.
// Keys only count while enabled, so typing a name or room code in the menu
// doesn't move anyone.

const held = new Set<string>();
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyX', 'ShiftLeft', 'ShiftRight'];
let enabled = false;

window.addEventListener('keydown', e => {
  if (!enabled || !KEYS.includes(e.code)) return;
  e.preventDefault();
  held.add(e.code);
});
window.addEventListener('keyup', e => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

/** Turns the keys and, on touch screens, the on-screen controls on or off. */
export function enableKeys(on: boolean) {
  enabled = on;
  if (!on) held.clear();
  enableTouch(on);
}

function keyboardInput(): Input {
  const on = (...codes: string[]) => codes.some(c => held.has(c));
  return {
    x: (on('ArrowRight', 'KeyD') ? 1 : 0) - (on('ArrowLeft', 'KeyA') ? 1 : 0),
    // Up on screen is towards the far side, which is -y in the sim.
    y: (on('ArrowDown', 'KeyS') ? 1 : 0) - (on('ArrowUp', 'KeyW') ? 1 : 0),
    kick: on('Space', 'KeyX'),
    sprint: on('ShiftLeft', 'ShiftRight'),
  };
}

/** The keys and the touch controls together: either can steer. */
export function playerInput(): Input {
  const k = keyboardInput();
  const t = touchInput();
  const keyed = k.x !== 0 || k.y !== 0;
  return {
    x: keyed ? k.x : t.x,
    y: keyed ? k.y : t.y,
    kick: k.kick || t.kick,
    sprint: k.sprint || t.sprint,
  };
}
