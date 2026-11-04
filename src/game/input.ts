import type { Input } from '../engine/sim';

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

export function enableKeys(on: boolean) {
  enabled = on;
  if (!on) held.clear();
}

export function keyboardInput(): Input {
  const on = (...codes: string[]) => codes.some(c => held.has(c));
  return {
    x: (on('ArrowRight', 'KeyD') ? 1 : 0) - (on('ArrowLeft', 'KeyA') ? 1 : 0),
    // Up on screen is towards the far side, which is -y in the sim.
    y: (on('ArrowDown', 'KeyS') ? 1 : 0) - (on('ArrowUp', 'KeyW') ? 1 : 0),
    kick: on('Space', 'KeyX'),
    sprint: on('ShiftLeft', 'ShiftRight'),
  };
}
