import { CONFIG } from '../config';
import { evenAttributes, type Attributes } from '../game/attributes';

// A player's own tuning, worked out once from their attributes when they're
// created. Each point away from 5 moves the values an attribute touches by
// 4%; see docs/attributes.md for the table.

export interface Stats {
  runSpeed: number;
  sprintSpeed: number;
  // Agility: how many times quicker than usual velocity closes on where
  // you're heading when that's a change of direction or a stop (the full
  // amount for an about turn or a stop, none for speeding up straight on).
  agility: number;
  // How much further ahead the ball runs when sprinting with it.
  sprintTouch: number;
  drain: number;
  regen: number;
  tiredTime: number;
  turnRateWithBall: number;
  // Speed kept on a sharp turn with the ball, and with the ball at all.
  turnSlowdown: number;
  dribbleSpeed: number;
  shotSpeed: number;
  chargeTime: number;
  // Most curl aftertouch can put on a kick, radians a metre.
  curl: number;
  pokeRange: number;
  slideReach: number;
  slideControlCos: number;
  loseDistance: number;
  // How long this player is off balance after being slid into.
  stumbleTime: number;
  // How hard this player's slide shoves others aside.
  shove: number;
  // In a challenge for the ball, the tackler's reach is scaled by their
  // tackle factor over the dribbler's hold factor.
  tackleFactor: number;
  holdFactor: number;
}

export const STEP = 0.04;
export const multiplier = (value: number, step = STEP) => 1 + step * (value - 5);
// Poke range moves twice as far per point, so the ring you see changes.
export const POKE_STEP = 0.08;
// And curl, so Power's effect on it is plain to see.
export const CURL_STEP = 0.08;
// Pace over 5 burns stamina faster, 6% a point: a quick player needs
// Stamina to keep it up.
export const PACE_DRAIN_STEP = 0.06;
// Strength cuts the time off balance after being slid into 10% a point:
// a strong player is back on their feet noticeably sooner.
export const STUMBLE_STEP = 0.1;
// Agility moves 8% a point, so a change of direction feels different.
export const AGILITY_STEP = 0.08;
// Shot speed loses only half as much per point below 5: a weak shooter
// still hits the ball hard enough to score.
export const SHOT_STEP_BELOW = 0.02;

export function statsFor(attrs: Attributes = evenAttributes()): Stats {
  const m = (k: keyof Attributes) => multiplier(attrs[k]);
  const { player, stamina, dribble, kick, tackle } = CONFIG;
  // A fraction that can't pass 1: it's the loss that shrinks.
  const keep = (f: number, by: number) => 1 - (1 - f) / by;
  return {
    runSpeed: player.runSpeed * m('pace'),
    sprintSpeed: player.sprintSpeed * m('pace'),
    sprintTouch: dribble.sprintTouch * Math.max(0, attrs.pace - 5),
    drain: (stamina.drain * multiplier(Math.max(5, attrs.pace), PACE_DRAIN_STEP)) / m('stamina'),
    regen: stamina.regen * m('stamina'),
    tiredTime: stamina.tiredTime / m('stamina'),
    agility: multiplier(attrs.dribbling, AGILITY_STEP),
    turnRateWithBall: player.turnRateWithBall * m('dribbling'),
    turnSlowdown: keep(dribble.turnSlowdown, m('dribbling')),
    dribbleSpeed: keep(dribble.speedFactor, m('dribbling')),
    shotSpeed: kick.shotSpeed * (attrs.power < 5 ? multiplier(attrs.power, SHOT_STEP_BELOW) : m('power')),
    chargeTime: kick.chargeTime / m('power'),
    curl: kick.curl * multiplier(attrs.power, CURL_STEP),
    pokeRange: tackle.pokeRange * multiplier(attrs.tackling, POKE_STEP),
    slideReach: tackle.slideReach * m('tackling'),
    slideControlCos: Math.cos(Math.acos(tackle.slideControlCos) * m('tackling')),
    loseDistance: dribble.loseDistance * m('strength'),
    stumbleTime: tackle.stumbleTime / multiplier(attrs.strength, STUMBLE_STEP),
    shove: tackle.slideShove * m('strength'),
    tackleFactor: m('tackling'),
    holdFactor: m('strength'),
  };
}
