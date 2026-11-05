import { CONFIG } from '../config';
import type { Input, Match, Player } from './sim';

// A goalkeeper: a bot kept to its own small box (see keepPlayerIn). It reads
// the game from where it stands, playing through the same Input as anyone:
// - Most of the time it stands between the ball and the middle of its goal,
//   coming off its line as play gets closer.
// - A shot at its goal it only reacts to after a moment, and it misjudges
//   where the shot will cross a little, more for harder shots. So a hard
//   shot in the corner, or one curled late, can beat it. One it can't reach
//   on its feet in time, it dives for.
// - A loose ball in its box it goes and gets; one at an attacker's feet up
//   close it now and then pokes at.
// - With the ball (which nobody can take off it) it holds on for a moment,
//   then passes to a teammate with a clear way to them, or clears it into
//   the emptiest space upfield, away from the other team.

export interface KeeperState {
  // Seconds left before it reacts to the shot in flight, and where it
  // guessed the shot would cross; null with no shot on.
  reactIn: number;
  guess: number | null;
  shotSeen: boolean;
  dived: boolean;
  holding: number;
  // Where it's kicking the ball out to, and seconds of charge still to put
  // on it, while kicking.
  target: { x: number; y: number; charge: number } | null;
  charging: number;
}

export interface KeeperMove {
  input: Input;
  // Throw itself this way (a unit vector), as a slide.
  dive?: { x: number; y: number };
}

const IDLE: Input = { x: 0, y: 0, kick: false, sprint: false };

export const newKeeperState = (): KeeperState => ({
  reactIn: 0, guess: null, shotSeen: false, dived: false, holding: 0, target: null, charging: 0,
});

/** The keeper's own goal line, which way is upfield from it, and its box. */
export function keeperBox(p: Player) {
  const { width } = CONFIG.pitch;
  const { boxDepth, boxHalf } = CONFIG.keeper;
  const side = p.team === 'gold' ? -1 : 1;
  const line = (side * width) / 2;
  return { side, line, depth: boxDepth, half: boxHalf };
}

const toward = (p: Player, x: number, y: number, sprint = false, near = 0.12): Input => {
  const dx = x - p.x;
  const dy = y - p.y;
  const len = Math.hypot(dx, dy);
  return len < near ? IDLE : { x: dx / len, y: dy / len, kick: false, sprint };
};

// How far the nearest opponent is from the ball's path out to (tx, ty).
function clearance(match: Match, p: Player, tx: number, ty: number) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const len2 = dx * dx + dy * dy || 1;
  let least = Infinity;
  for (const q of match.players) {
    if (q.team === p.team) continue;
    const t = Math.max(0, Math.min(1, ((q.x - p.x) * dx + (q.y - p.y) * dy) / len2));
    least = Math.min(least, Math.hypot(p.x + dx * t - q.x, p.y + dy * t - q.y));
  }
  return least;
}

// Where to kick it out: a teammate with a clear way to them, nearest first;
// failing that, the emptiest direction upfield.
function chooseTarget(match: Match, p: Player, side: number) {
  const { width, height } = CONFIG.pitch;
  const clear = CONFIG.keeper.clearPass;
  const mates = match.players
    .filter(q => q.team === p.team && q !== p && !q.keeper)
    .map(q => ({ q, room: clearance(match, p, q.x, q.y), dist: Math.hypot(q.x - p.x, q.y - p.y) }))
    .filter(m => m.room > clear && m.dist > 3)
    .sort((a, b) => a.dist - b.dist);
  const mate = mates[0];
  if (mate) return { x: mate.q.x, y: mate.q.y, charge: Math.min(p.stats.chargeTime, 0.1 + mate.dist * 0.025) };
  let best = { x: p.x - side * 12, y: 0, charge: p.stats.chargeTime, room: -1 };
  for (let deg = -55; deg <= 55; deg += 11) {
    const a = (deg * Math.PI) / 180;
    const x = Math.max(-width / 2, Math.min(width / 2, p.x - side * Math.cos(a) * 14));
    const y = Math.max(-height / 2 + 1, Math.min(height / 2 - 1, p.y + Math.sin(a) * 14));
    // Straighter is a little better, all else equal.
    const room = clearance(match, p, x, y) - Math.abs(deg) * 0.004;
    if (room > best.room) best = { x, y, charge: p.stats.chargeTime, room };
  }
  return best;
}

export function keeperInput(match: Match, p: Player, random: () => number): KeeperMove {
  const k = (p.keeperState ??= newKeeperState());
  const dt = CONFIG.tick;
  const cfg = CONFIG.keeper;
  const { ball } = match;
  const { side, line, depth, half } = keeperBox(p);
  if (match.restartIn > 0 || match.kickoffHeld) {
    Object.assign(k, newKeeperState());
    return { input: toward(p, line - side * cfg.lineOff, 0) };
  }
  // Down after a dive, or caught out: nothing to decide.
  if (p.action !== 'none' && p.action !== 'charge') return { input: IDLE };

  // With the ball: hold, pick where it goes, turn to it, charge, kick.
  if (match.owner === p.id) {
    k.holding += dt;
    k.guess = null;
    if (k.charging > 0) {
      k.charging -= dt;
      return { input: { ...IDLE, kick: k.charging > 0 } };
    }
    if (k.holding < cfg.holdTime) return { input: IDLE };
    // Looked at again while turning, in case someone steps into the way.
    k.target = chooseTarget(match, p, side);
    const dx = k.target.x - p.x;
    const dy = k.target.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    if ((p.fx * dx + p.fy * dy) / dist > 0.97) {
      k.charging = k.target.charge;
      return { input: { ...IDLE, kick: true } };
    }
    // Turn on the spot towards it (a step, so the turn happens).
    return { input: { x: dx / dist, y: dy / dist, kick: false, sprint: false } };
  }
  k.holding = 0;
  k.charging = 0;
  k.target = null;

  const speed = Math.hypot(ball.vx, ball.vy);
  // A shot: loose, heading for its goal fast, and set to cross near the
  // mouth. Where it'll cross is guessed once, when it reacts.
  const keeperX = line - side * cfg.lineOff;
  const heading = match.owner === null && ball.vx * side > 0 && speed > cfg.shotSpeed;
  const crossAt = heading ? ball.y + ball.vy * ((keeperX - ball.x) / ball.vx) : 0;
  const onTarget = heading && Math.abs(crossAt) < CONFIG.pitch.goalWidth / 2 + 1.2 && (keeperX - ball.x) * side > 0;
  if (onTarget && !k.shotSeen) {
    k.shotSeen = true;
    k.dived = false;
    k.reactIn = cfg.reaction;
    // Harder shots are harder to read.
    const error = cfg.error * (0.4 + speed / CONFIG.kick.shotSpeed);
    k.guess = crossAt + (random() * 2 - 1) * error;
  }
  if (!onTarget) {
    k.shotSeen = false;
    k.guess = null;
  }
  if (k.guess !== null) {
    if (k.reactIn > 0) {
      k.reactIn -= dt;
      return { input: IDLE };
    }
    const to = Math.max(-half, Math.min(half, k.guess));
    // Too far to get there on its feet before the ball does: dive, towards
    // where it guessed and a touch forward, to meet it.
    const arrive = Math.max(0, (keeperX - ball.x) / ball.vx);
    const gap = to - p.y;
    const onFoot = p.stats.sprintSpeed * arrive * 0.6;
    if (!k.dived && Math.abs(gap) > cfg.diveFrom && Math.abs(gap) > onFoot && arrive < cfg.diveWithin) {
      k.dived = true;
      const fx = -side * 0.25;
      const fy = Math.sign(gap);
      const l = Math.hypot(fx, fy);
      return { input: IDLE, dive: { x: fx / l, y: fy / l } };
    }
    return { input: toward(p, keeperX, to, true, 0.05) };
  }

  // A loose, slowish ball in or at the edge of its box: go and get it.
  const inBox = (x: number, y: number, slack: number) =>
    (line - x) * side >= -slack && (line - x) * side <= depth + slack && Math.abs(y) <= half + slack;
  if (match.owner === null && speed < cfg.collectSpeed && inBox(ball.x, ball.y, 0.6)) {
    return { input: toward(p, ball.x, ball.y, true, 0) };
  }

  // An attacker on the ball right up close: now and then, a poke at it.
  const owner = match.players.find(q => q.id === match.owner);
  if (owner && owner.team !== p.team && Math.hypot(ball.x - p.x, ball.y - p.y) < cfg.pokeAt && p.action === 'none') {
    if (random() < cfg.pokeChance) return { input: { ...toward(p, ball.x, ball.y), kick: true } };
  }

  // Otherwise: between the ball and the middle of the goal, further off its
  // line the closer the ball, inside its box.
  const dx = ball.x - line;
  const dy = ball.y;
  const dist = Math.hypot(dx, dy) || 1;
  const off = cfg.lineOff + (depth - cfg.lineOff - 0.3) * Math.max(0, Math.min(1, (16 - dist) / 12));
  let tx = line + (dx / dist) * off;
  let ty = (dy / dist) * off * 2.2;
  tx = side > 0 ? Math.min(line - cfg.lineOff * 0.5, Math.max(line - depth, tx)) : Math.max(line + cfg.lineOff * 0.5, Math.min(line + depth, tx));
  ty = Math.max(-CONFIG.pitch.goalWidth / 2, Math.min(CONFIG.pitch.goalWidth / 2, ty));
  return { input: toward(p, tx, ty) };
}
