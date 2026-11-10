import { CONFIG } from '../config';
import { curlStep } from './curl';
import { NO_INPUT, toward } from './input';
import { homeSide, passTarget, type Input, type Match, type Player } from './sim';

// A goalkeeper: a bot kept to its own small box (see keepPlayerIn). It reads
// the game from where it stands, playing through the same Input as anyone:
// - Most of the time it stands between the ball and the middle of its goal,
//   coming off its line as play gets closer, and from an angle shifted
//   towards its near post.
// - A shot at its goal it only reacts to a moment after a fast ball comes
//   into its half (a little quicker or slower shot to shot), meeting it
//   where it stands. It reads the shot straight, but only part of its curl,
//   looking again every so often. One it can't reach on its feet, it dives
//   for: always the same choice, a late reaction just a late dive. It reads only part of a shot's curl, looking
//   again every so often as the ball comes, so a hard shot in the corner,
//   or one curled late, can still beat it. One it can't reach on its feet
//   in time, it dives for.
// - A loose ball in its box it goes and gets; one at an attacker's feet up
//   close it now and then pokes at.
// - While an attacker in range winds up a shot, it walks out towards them
//   to narrow the angle.
// - With the ball (which nobody can take off it) it holds on for a moment,
//   then passes to the most open teammate with a clear way to them, or
//   clears it into the emptiest space upfield, away from the other team.

export interface KeeperState {
  // Seconds a fast loose ball has been coming at its half, and how long it
  // takes to react to this shot (it varies a little shot to shot); where it
  // reads the shot will cross, null with no shot on, and seconds until it
  // looks again.
  watching: number;
  delay: number;
  guess: number | null;
  // How far upfield it stood when it saw the shot (never behind its usual
  // spot off the line): it meets the shot there, rather than backing off.
  at: number;
  readIn: number;
  shotSeen: boolean;
  dived: boolean;
  // The attacker it last decided about coming out to, and whether it is.
  rushAt: string | null;
  rushing: boolean;
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


export const newKeeperState = (): KeeperState => ({
  watching: 0, delay: 0, guess: null, at: 0, readIn: 0, shotSeen: false, dived: false, rushAt: null, rushing: false, holding: 0, target: null, charging: 0,
});

/** The keeper's own goal line, which way is upfield from it, its small box
 *  and the big box it may come out into. */
export function keeperBox(p: Player) {
  const { width } = CONFIG.pitch;
  const { boxDepth, boxHalf, areaDepth, areaHalf } = CONFIG.keeper;
  const side = homeSide(p.team);
  const line = (side * width) / 2;
  return { side, line, depth: boxDepth, half: boxHalf, areaDepth, areaHalf };
}

// How far off its line it stands with the ball dist metres from the middle
// of its goal: further the closer the ball, up to just inside the front of
// its small box (depth deep).
function standOff(dist: number, depth: number) {
  const { lineOff, comeOutFrom, comeOutOver } = CONFIG.keeper;
  return lineOff + (depth - lineOff - 0.3) * Math.max(0, Math.min(1, (comeOutFrom - dist) / comeOutOver));
}

// The spot `depth` metres out from its goal line on the line splitting the
// angle the goal makes from the ball (the posts are as far round either
// side), and at least `gap` from the ball. From out wide that's near the
// near post, where a line to the middle of the goal would leave it open.
function onAngle(ball: { x: number; y: number }, line: number, side: number, depth: number, gap = 0) {
  const half = CONFIG.pitch.goalWidth / 2;
  const unit = (x: number, y: number) => {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  };
  const a = unit(line - ball.x, half - ball.y);
  const b = unit(line - ball.x, -half - ball.y);
  const dir = unit(a.x + b.x, a.y + b.y);
  // How far along that line it is to just in front of the goal line: it
  // never stands behind the ball, nor in its own net.
  const toLine = Math.abs(dir.x) > 1e-3 ? (line - side * 0.3 - ball.x) / dir.x : 0;
  if (toLine <= 0) return { x: line - side * CONFIG.keeper.lineOff, y: Math.max(-half, Math.min(half, ball.y)) };
  const tx = line - side * depth;
  let t = (tx - ball.x) / dir.x;
  t = Math.max(t, Math.min(gap, toLine), Math.min(0.8, toLine));
  t = Math.min(t, toLine);
  return { x: ball.x + dir.x * t, y: ball.y + dir.y * t };
}

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

// How far the nearest opponent is from (x, y).
function space(match: Match, p: Player, x: number, y: number) {
  let least = Infinity;
  for (const q of match.players) if (q.team !== p.team) least = Math.min(least, Math.hypot(q.x - x, q.y - y));
  return least;
}

// Where the ball will cross x = toX, following `read` of its curl (0 as if
// it went straight, 1 exactly); walls aren't foreseen. Null if it won't
// get there.
function predictCross(match: Match, toX: number, read: number) {
  const dt = CONFIG.tick;
  const { ball } = match;
  let { x, y } = ball;
  const c = { vx: ball.vx, vy: ball.vy, spin: match.spin * read, curled: match.curled * read };
  for (let i = 0; i < 4 / dt; i++) {
    if (Math.hypot(c.vx, c.vy) < 1) return null;
    if (c.spin) curlStep(c, dt);
    const nx = x + c.vx * dt;
    const ny = y + c.vy * dt;
    if ((toX - x) * (toX - nx) <= 0 && nx !== x) return y + (ny - y) * ((toX - x) / (nx - x));
    x = nx;
    y = ny;
    c.vx *= ball.damping;
    c.vy *= ball.damping;
  }
  return null;
}

// Where to kick it out: the most open teammate (furthest from any opponent)
// with a clear way to them; failing that, the emptiest direction upfield.
function chooseTarget(match: Match, p: Player, side: number) {
  const { width, height } = CONFIG.pitch;
  const clear = CONFIG.keeper.clearPass;
  const mates = match.players
    .filter(q => q.team === p.team && q !== p && !q.keeper)
    .map(q => ({ q, room: clearance(match, p, q.x, q.y), alone: space(match, p, q.x, q.y), dist: Math.hypot(q.x - p.x, q.y - p.y) }))
    .filter(m => m.room > clear && m.dist > 3)
    .sort((a, b) => b.alone - a.alone);
  const mate = mates[0];
  if (mate) {
    // Weighted for how far they are, to where they'll be when it gets there
    // (a step ahead of a runner), and weighted again for that. Its facing
    // is locked while it charges, so it lines up closely first.
    const hold = (dist: number) => Math.min(p.stats.chargeTime, 0.1 + dist * 0.025);
    const speed = (secs: number) => CONFIG.kick.passSpeed + (p.stats.shotSpeed - CONFIG.kick.passSpeed) * Math.min(1, secs / p.stats.chargeTime);
    let charge = hold(mate.dist);
    let to = { x: mate.q.x, y: mate.q.y };
    for (let i = 0; i < 2; i++) {
      // Struck once it's charged: they run on meanwhile.
      to = passTarget(match.ball.x, match.ball.y, speed(charge), match.ball.damping, mate.q, charge);
      charge = hold(Math.hypot(to.x - p.x, to.y - p.y));
    }
    return { ...to, charge };
  }
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
  const { side, line, depth, half, areaDepth, areaHalf } = keeperBox(p);
  if (match.restartIn > 0 || match.kickoffHeld) {
    Object.assign(k, newKeeperState());
    return { input: toward(p, line - side * cfg.lineOff, 0) };
  }
  // Down after a dive, or caught out: nothing to decide.
  if (p.action !== 'none' && p.action !== 'charge') return { input: NO_INPUT };

  // With the ball: hold, pick where it goes, turn to it, charge, kick.
  if (match.owner === p.id) {
    k.holding += dt;
    k.guess = null;
    if (k.charging > 0) {
      k.charging -= dt;
      return { input: { ...NO_INPUT, kick: k.charging > 0 } };
    }
    if (k.holding < cfg.holdTime) return { input: NO_INPUT };
    // Looked at again while turning, in case someone steps into the way.
    k.target = chooseTarget(match, p, side);
    const dx = k.target.x - p.x;
    const dy = k.target.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    if ((p.fx * dx + p.fy * dy) / dist > cfg.kickAim) {
      k.charging = k.target.charge;
      return { input: { ...NO_INPUT, kick: true } };
    }
    // Turn on the spot towards it (a step, so the turn happens).
    return { input: { x: dx / dist, y: dy / dist, kick: false, sprint: false } };
  }
  k.holding = 0;
  k.charging = 0;
  k.target = null;

  const speed = Math.hypot(ball.vx, ball.vy);
  const keeperX = line - side * cfg.lineOff;
  const { width, goalWidth } = CONFIG.pitch;
  // It's watching once a fast loose ball is in its half; it can react a
  // moment after that, so a shot off a wall doesn't catch it cold.
  const loose = match.owner === null && speed > cfg.shotSpeed;
  const inHalf = loose && (keeperX - ball.x) * side > 0 && Math.abs(keeperX - ball.x) < width / 2;
  k.watching = inHalf ? k.watching + dt : 0;
  // A shot: loose, fast, and set to cross near the mouth, by its read.
  const crossAt = inHalf ? predictCross(match, keeperX, cfg.curlRead) : null;
  const onTarget = crossAt !== null && Math.abs(crossAt) < goalWidth / 2 + 1.2;
  if (onTarget && !k.shotSeen) {
    k.shotSeen = true;
    k.dived = false;
    k.guess = null;
    k.readIn = 0;
    // Always the same decision; only how quickly it's made varies.
    // Set and quicker for a shot from close; the usual from range.
    const far = Math.max(0, Math.min(1, (Math.hypot(ball.x - p.x, ball.y - p.y) - cfg.closeFrom) / (cfg.farFrom - cfg.closeFrom)));
    const base = cfg.reactionClose + (cfg.reaction - cfg.reactionClose) * far;
    const spread = cfg.spreadClose + (cfg.reactionSpread - cfg.spreadClose) * far;
    k.delay = base + random() * spread;
    k.at = side > 0 ? Math.min(p.x, keeperX) : Math.max(p.x, keeperX);
  }
  if (!onTarget) {
    k.shotSeen = false;
    k.guess = null;
  }
  if (k.shotSeen) {
    if (k.watching < k.delay) return { input: NO_INPUT };
    k.readIn -= dt;
    if (k.guess === null || k.readIn <= 0) {
      // Where it'll pass where the keeper stands, by its read of the curl.
      k.guess = predictCross(match, k.at, cfg.curlRead) ?? crossAt!;
      k.readIn = cfg.reread;
    }
  }
  if (k.guess !== null) {
    const to = Math.max(-half, Math.min(half, k.guess));
    // Too far to get there on its feet before the ball does: dive, towards
    // where it guessed and a touch forward, to meet it.
    const arrive = ball.vx * side > 0 ? (k.at - ball.x) / ball.vx : Infinity;
    const gap = to - p.y;
    const onFoot = p.stats.sprintSpeed * arrive * cfg.footReach;
    if (!k.dived && Math.abs(gap) > cfg.diveFrom && Math.abs(gap) > onFoot && arrive < cfg.diveWithin) {
      k.dived = true;
      const fx = -side * 0.25;
      const fy = Math.sign(gap);
      const l = Math.hypot(fx, fy);
      return { input: NO_INPUT, dive: { x: fx / l, y: fy / l } };
    }
    // Flat out only while it's well off its spot, so it doesn't overrun it.
    return { input: toward(p, k.at, to, Math.abs(gap) > 0.6, 0.05) };
  }

  const inside = (x: number, y: number, d: number, h: number, slack: number) =>
    (line - x) * side >= -slack && (line - x) * side <= d + slack && Math.abs(y) <= h + slack;
  const eta = (q: Player) => Math.hypot(ball.x - q.x, ball.y - q.y) / q.stats.sprintSpeed;
  const others = match.players.filter(q => q !== p && !q.keeper);
  const mateNearer = others.some(q => q.team === p.team && eta(q) < eta(p));

  // A loose, slowish ball in its small box: go and get it. One further out
  // in the big box only if it'll get there well before any opponent.
  if (match.owner === null && speed < cfg.collectSpeed) {
    if (inside(ball.x, ball.y, depth, half, 0.6)) return { input: toward(p, ball.x, ball.y, true, 0) };
    const theirs = Math.min(Infinity, ...others.filter(q => q.team !== p.team).map(eta));
    if (inside(ball.x, ball.y, areaDepth, areaHalf, 0.3) && !mateNearer && eta(p) < theirs * cfg.claimMargin) {
      return { input: toward(p, ball.x, ball.y, true, 0) };
    }
  }

  // An attacker on the ball coming into the big box with nobody closer to
  // stop them: now and then it comes out to close them down, standing in
  // their way to goal and poking at the ball once it's close.
  const owner = match.players.find(q => q.id === match.owner);
  const attacker = owner && owner.team !== p.team ? owner : null;
  if (attacker && attacker.id !== k.rushAt) {
    k.rushAt = attacker.id;
    k.rushing = random() < cfg.rushChance;
  }
  if (!attacker) k.rushAt = null;
  const near = attacker && Math.hypot(attacker.x - p.x, attacker.y - p.y) < cfg.rushFrom;
  const gap = Math.hypot(ball.x - p.x, ball.y - p.y);
  // Pokes go the way it faces, so only once it's turned to the ball.
  const facingBall = (p.fx * (ball.x - p.x) + p.fy * (ball.y - p.y)) / (gap || 1) > 0.8;
  // Dribbled at, right up close in its box, it always closes them down,
  // rushing or not. One winding up a shot it sets itself for instead.
  const closeIn = attacker && attacker.action !== 'charge' && gap < cfg.closeDown && inside(ball.x, ball.y, areaDepth, areaHalf, 0.5);
  if (attacker && !mateNearer && (closeIn || (k.rushing && near && inside(ball.x, ball.y, areaDepth, areaHalf, 1.5)))) {
    if (gap < cfg.pokeAt) {
      // In range: straight at the ball, turning to it, and poke once facing.
      if (facingBall && random() < cfg.rushPoke) return { input: { ...toward(p, ball.x, ball.y), kick: true } };
      return { input: toward(p, ball.x, ball.y, false, 0) };
    }
    // Otherwise into their way to goal, never past its own line.
    const gx = ball.x - line;
    const l = Math.hypot(gx, ball.y) || 1;
    const wx = ball.x - (gx / l) * 0.9;
    const tx = side > 0 ? Math.min(wx, line - 0.3) : Math.max(wx, line + 0.3);
    return { input: toward(p, tx, ball.y - (ball.y / l) * 0.9, true) };
  }

  // An attacker on the ball right up close: now and then, a poke at it.
  if (attacker && gap < cfg.pokeAt && facingBall && p.action === 'none') {
    if (random() < cfg.pokeChance) return { input: { ...toward(p, ball.x, ball.y), kick: true } };
  }

  // An attacker winding up a shot in range: it walks out on the angle,
  // further the longer the wind-up, to narrow it; never within narrowGap of
  // the ball, and never out of its big box. Once the shot's struck, the
  // shot code above takes over.
  if (attacker && attacker.action === 'charge') {
    const gx = ball.x - line;
    const l = Math.hypot(gx, ball.y) || 1;
    if (l < cfg.narrowFrom) {
      const base = standOff(l, depth);
      const out = Math.min(base + cfg.narrowBy * Math.min(1, attacker.charge * 1.5), areaDepth);
      if (out > base) {
        // Out from the line as far as `out` would take it along the line to
        // the ball (so less from a tight angle).
        const at = onAngle(ball, line, side, out * Math.abs(gx) / l, cfg.narrowGap);
        const tx = side > 0 ? Math.min(line - cfg.lineOff * 0.5, Math.max(line - areaDepth, at.x)) : Math.max(line + cfg.lineOff * 0.5, Math.min(line + areaDepth, at.x));
        const ty = Math.max(-areaHalf, Math.min(areaHalf, at.y));
        return { input: toward(p, tx, ty) };
      }
    }
  }

  // Otherwise: on the angle, further off its line the closer the ball,
  // inside its box.
  const dx = ball.x - line;
  const dy = ball.y;
  const dist = Math.hypot(dx, dy) || 1;
  const off = standOff(dist, depth);
  const at = onAngle(ball, line, side, off * Math.abs(dx) / dist);
  let tx = at.x;
  let ty = at.y;
  tx = side > 0 ? Math.min(line - cfg.lineOff * 0.5, Math.max(line - depth, tx)) : Math.max(line + cfg.lineOff * 0.5, Math.min(line + depth, tx));
  ty = Math.max(-CONFIG.pitch.goalWidth / 2, Math.min(CONFIG.pitch.goalWidth / 2, ty));
  return { input: toward(p, tx, ty) };
}
