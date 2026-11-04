import { CONFIG } from '../config';
import { evenAttributes, type Attributes } from '../game/attributes';

// A player's own tuning, worked out once from their attributes when they're
// created. Each point away from 5 moves the values an attribute touches by
// 4%; see docs/attributes.md for the table.

export interface Stats {
  runSpeed: number;
  sprintSpeed: number;
  drain: number;
  regen: number;
  tiredTime: number;
  turnRateWithBall: number;
  // Speed kept on a sharp turn with the ball, and with the ball at all.
  turnSlowdown: number;
  dribbleSpeed: number;
  shotSpeed: number;
  chargeTime: number;
  pokeRange: number;
  slideReach: number;
  slideControlCos: number;
  loseDistance: number;
  // How long this player is off balance after being slid into.
  stumbleTime: number;
  // How hard this player's slide shoves others aside.
  shove: number;
}

export const STEP = 0.04;
export const multiplier = (value: number) => 1 + STEP * (value - 5);

export function statsFor(attrs: Attributes = evenAttributes()): Stats {
  const m = (k: keyof Attributes) => multiplier(attrs[k]);
  const { player, stamina, dribble, kick, tackle } = CONFIG;
  // A fraction that can't pass 1: it's the loss that shrinks.
  const keep = (f: number, by: number) => 1 - (1 - f) / by;
  return {
    runSpeed: player.runSpeed * m('pace'),
    sprintSpeed: player.sprintSpeed * m('pace'),
    drain: stamina.drain / m('stamina'),
    regen: stamina.regen * m('stamina'),
    tiredTime: stamina.tiredTime / m('stamina'),
    turnRateWithBall: player.turnRateWithBall * m('dribbling'),
    turnSlowdown: keep(dribble.turnSlowdown, m('dribbling')),
    dribbleSpeed: keep(dribble.speedFactor, m('dribbling')),
    shotSpeed: kick.shotSpeed * m('power'),
    chargeTime: kick.chargeTime / m('power'),
    pokeRange: tackle.pokeRange * m('tackling'),
    slideReach: tackle.slideReach * m('tackling'),
    slideControlCos: Math.cos(Math.acos(tackle.slideControlCos) * m('tackling')),
    loseDistance: dribble.loseDistance * m('strength'),
    stumbleTime: tackle.stumbleTime / m('strength'),
    shove: tackle.slideShove * m('strength'),
  };
}
