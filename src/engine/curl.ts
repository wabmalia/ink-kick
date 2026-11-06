import { CONFIG } from '../config';

// A curling ball, one tick at a time: its path turns by its spin (radians a
// metre), the spin fading as it goes. However hard it's curled, it bends so
// far and no further: full until most of the way to maxTurn, then easing
// off, so it never loops round. Shared by the sim and the keeper reading a
// shot, so they can't disagree.

export interface Curling {
  vx: number;
  vy: number;
  // Radians the path turns a metre, and how far it's turned so far.
  spin: number;
  curled: number;
}

export function curlStep(c: Curling, dt: number) {
  const { maxTurn, turnEase, spinFade } = CONFIG.kick;
  const left = Math.max(0, Math.min(1, (maxTurn - Math.abs(c.curled)) / (maxTurn * turnEase)));
  const a = c.spin * Math.hypot(c.vx, c.vy) * dt * left;
  c.curled += a;
  const { vx, vy } = c;
  c.vx = vx * Math.cos(a) - vy * Math.sin(a);
  c.vy = vx * Math.sin(a) + vy * Math.cos(a);
  c.spin *= Math.exp(-spinFade * dt);
}
