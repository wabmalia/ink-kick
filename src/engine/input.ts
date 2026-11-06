import type { Input } from './sim';

// Inputs the bots, the keepers and the training ground make for the players
// they move.

/** Standing still, pressing nothing. */
export const NO_INPUT: Readonly<Input> = Object.freeze({ x: 0, y: 0, kick: false, sprint: false });

/** Heading for (x, y), or standing still once within `near` of it. */
export function toward(from: { x: number; y: number }, x: number, y: number, sprint = false, near = 0.12): Input {
  const dx = x - from.x;
  const dy = y - from.y;
  const len = Math.hypot(dx, dy);
  return len < near ? NO_INPUT : { x: dx / len, y: dy / len, kick: false, sprint };
}
