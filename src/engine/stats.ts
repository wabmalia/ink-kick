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
  // How long this player is off balance after being slid into, and how long
  // they take to get up after a slide of their own.
  stumbleTime: number;
  recoverTime: number;
  // How hard this player's slide shoves others aside.
  shove: number;
  // In a challenge for the ball, the tackler's reach is scaled by their
  // tackle factor over the dribbler's hold factor.
  tackleFactor: number;
  holdFactor: number;
  // Close control (from Dribbling): in a challenge, the dribbler's hold
  // factor is multiplied by this too.
  ballControl: number;
}

export const STEP = 0.04;
export const multiplier = (value: number, step = STEP) => 1 + step * (value - 5);
// Poke range moves twice as far per point, so the ring you see changes.
export const POKE_STEP = 0.08;
// And curl, so Power's effect on it is plain to see.
export const CURL_STEP = 0.08;
// Pace burns stamina 5% a point faster above 5, and slower below it: a
// quick player needs Stamina to keep it up, a slow one rarely tires.
export const PACE_DRAIN_STEP = 0.05;
// Strength cuts the time off balance after being slid into, and the time
// getting up after a slide, 10% a point: a strong player is back on their
// feet noticeably sooner, and a weak one pays for a slide that misses.
export const STUMBLE_STEP = 0.1;
// Strength's other values move 6% a point, wider than most, so a strong
// player is plainly hard to knock off the ball and a weak one easy.
export const STRENGTH_STEP = 0.06;
// Agility moves 8% a point, so a change of direction feels different.
export const AGILITY_STEP = 0.08;
// The controlled-slide angle narrows 8% a point below Tackling 5 (4% above):
// a poor tackler only keeps the ball sliding dead-on to it, and otherwise
// knocks it on.
export const SLIDE_CONTROL_STEP_BELOW = 0.08;
// Shot speed loses only half as much per point below 5: a weak shooter
// still hits the ball hard enough to score.
export const SHOT_STEP_BELOW = 0.02;

export function statsFor(attrs: Attributes = evenAttributes()): Stats {
  const m = (k: keyof Attributes) => multiplier(attrs[k]);
  const strength = multiplier(attrs.strength, STRENGTH_STEP);
  const upSooner = multiplier(attrs.strength, STUMBLE_STEP);
  const { player, stamina, dribble, kick, tackle } = CONFIG;
  // A fraction that can't pass 1: it's the loss that shrinks.
  const keep = (f: number, by: number) => 1 - (1 - f) / by;
  return {
    runSpeed: player.runSpeed * m('pace'),
    sprintSpeed: player.sprintSpeed * m('pace'),
    sprintTouch: dribble.sprintTouch * Math.max(0, attrs.pace - 5),
    drain: (stamina.drain * multiplier(attrs.pace, PACE_DRAIN_STEP)) / m('stamina'),
    regen: stamina.regen * m('stamina'),
    tiredTime: stamina.tiredTime / m('stamina'),
    agility: multiplier(attrs.dribbling, AGILITY_STEP),
    turnRateWithBall: player.turnRateWithBall * m('dribbling'),
    turnSlowdown: keep(dribble.turnSlowdown, m('dribbling')),
    dribbleSpeed: Math.min(1, dribble.speedFactor + dribble.speedStep * (attrs.dribbling - 5)),
    shotSpeed: kick.shotSpeed * (attrs.power < 5 ? multiplier(attrs.power, SHOT_STEP_BELOW) : m('power')),
    chargeTime: kick.chargeTime / m('power'),
    curl: kick.curl * multiplier(attrs.power, CURL_STEP),
    pokeRange: tackle.pokeRange * multiplier(attrs.tackling, POKE_STEP),
    slideReach: tackle.slideReach * m('tackling'),
    slideControlCos: Math.cos(Math.acos(tackle.slideControlCos) * (attrs.tackling < 5 ? multiplier(attrs.tackling, SLIDE_CONTROL_STEP_BELOW) : m('tackling'))),
    loseDistance: dribble.loseDistance * strength,
    stumbleTime: tackle.stumbleTime / upSooner,
    recoverTime: tackle.recoverTime / upSooner,
    shove: tackle.slideShove * strength,
    tackleFactor: m('tackling'),
    holdFactor: strength,
    ballControl: m('dribbling'),
  };
}
