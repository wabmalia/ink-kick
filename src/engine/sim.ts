import { CONFIG } from '../config';
import type { Attributes } from '../game/attributes';
import { statsFor, type Stats } from './stats';
import { keeperBox, keeperInput, type KeeperState } from './keeper';

// The match as plain 2D data: discs on a rectangle. Nothing here knows about
// Three.js; the scene maps sim (x, y) to world (x, 0, y). Gold attacks +x,
// red attacks -x.
//
// One button does everything: with the ball, hold to charge a kick and
// release to strike it; without, press to tackle, which pokes a foot in when
// the ball is close and slides in when it isn't.

export type Team = 'gold' | 'red';

export type Action =
  | 'none'
  // Kick button held with the ball, building power.
  | 'charge'
  | 'poke'
  | 'slide'
  | 'recover'
  | 'stumble';

export interface Disc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  invMass: number;
  damping: number;
  bounce: number;
}

export interface Player extends Disc {
  id: string;
  team: Team;
  // Unit vector the player faces; the ball sits this way while dribbling.
  fx: number;
  fy: number;
  action: Action;
  actionT: number;
  // 0..1 while charging.
  charge: number;
  // 0..1; tired counts down once it runs dry.
  stamina: number;
  tired: number;
  sprinting: boolean;
  // Can't trap the ball until this reaches 0.
  cooldown: number;
  // Whether the current poke or slide already touched the ball.
  struck: boolean;
  kickDown: boolean;
  sprintDown: boolean;
  // Speeds, reaches and times from the player's attributes. Only the host's
  // sim reads them; they aren't sent in snapshots.
  stats: Stats;
  // A goalkeeper: a bot kept to its small box, untouchable holding the ball.
  keeper?: boolean;
  keeperState?: KeeperState;
}

export interface Input {
  x: number;
  y: number;
  kick: boolean;
  sprint: boolean;
}

// How a match is won: first to a number of goals ("best of" 2n-1), most
// goals when the clock runs out (then a golden goal if level), or never (the
// bots behind the menu).
export type Rules =
  | { kind: 'endless' }
  | { kind: 'first'; goals: number }
  | { kind: 'timed'; seconds: number };

export interface GoalRecord {
  team: Team;
  // Who last kicked, dribbled or tackled the ball, if anyone.
  scorer: string | null;
  // Put in their own net: the scorer is on the other team.
  own: boolean;
  // Seconds of play when it went in.
  at: number;
}

export interface Match {
  players: Player[];
  ball: Disc;
  posts: Disc[];
  // Id of the player dribbling, if any.
  owner: string | null;
  // While above 0, the dribbler can't lose the ball for being too far from
  // it, while it's pulled in to their feet.
  pullingIn: number;
  score: Record<Team, number>;
  // Counts down after a goal; the kickoff happens when it reaches 0.
  restartIn: number;
  // The team that takes the next kickoff: whoever conceded the last goal.
  kickoffTeam: Team;
  // Counts down while everyone waits for the coin toss; nobody moves.
  holdFor: number;
  coinPending: boolean;
  // From a kickoff until the ball is played: everyone stays in their own
  // half, and the defending team out of the centre circle.
  kickoffHeld: boolean;
  // The training ground: no goals, no kickoffs, roam anywhere.
  practice: boolean;
  // State of the match's random numbers.
  seed: number;
  rules: Rules;
  // Seconds of play: stopped for the coin toss and after each goal.
  clock: number;
  goals: GoalRecord[];
  // Who last kicked, dribbled or tackled the ball.
  lastTouch: string | null;
  // Set once the match is won; everything stops.
  over: { winner: Team | null } | null;
  // The ball's curl, radians its path turns a metre (anticlockwise
  // positive), and the kick it can still be added to by aftertouch.
  spin: number;
  // How far the curl has turned the ball's path since the kick, radians.
  curled: number;
  aftertouch: { player: string; dx: number; dy: number; left: number } | null;
  // Just after a keeper kicks it out: the other team can't touch the ball
  // for this many seconds more.
  guard: { team: Team; left: number } | null;
}

export type SimEvent =
  | { type: 'kick'; player: string; power: number }
  | { type: 'trap'; player: string }
  | { type: 'poke'; player: string }
  | { type: 'slide'; player: string }
  | { type: 'steal'; player: string; from: string }
  | { type: 'feint'; player: string }
  // A dribbler riding a tackle that reached them.
  | { type: 'shrug'; player: string; from: string }
  | { type: 'goal'; team: Team; scorer: string | null; own: boolean; at: number }
  // The match is won: who by, and every goal, for the scoreboard.
  | { type: 'end'; winner: Team | null; score: Record<Team, number>; goals: GoalRecord[] }
  // At the start of a match: who the coin gave the kickoff to.
  | { type: 'coin'; team: Team }
  | { type: 'kickoff' };

const still = () => ({ vx: 0, vy: 0 });
const NO_INPUT: Input = { x: 0, y: 0, kick: false, sprint: false };

export function createPlayer(id: string, team: Team, attrs?: Attributes, keeper = false): Player {
  const p = CONFIG.player;
  return {
    id, team, x: 0, y: 0, ...still(),
    r: p.radius, invMass: p.invMass, damping: 1, bounce: p.bounce,
    fx: team === 'gold' ? 1 : -1, fy: 0,
    action: 'none', actionT: 0, charge: 0,
    stamina: 1, tired: 0, sprinting: false,
    cooldown: 0, struck: false, kickDown: false, sprintDown: false,
    stats: statsFor(attrs),
    ...(keeper ? { keeper: true } : {}),
  };
}

// kickoff: the team starting on the ball. coin: open with a coin toss
// (a 'coin' event, then everyone held still while it plays).
/** The goalkeepers' ids, one a team. */
export const KEEPER_IDS: Record<Team, string> = { gold: 'keeper-gold', red: 'keeper-red' };

export function createMatch(players: Player[], opts: { kickoff?: Team; coin?: boolean; practice?: boolean; seed?: number; rules?: Rules; keepers?: boolean } = {}): Match {
  if (opts.keepers) players = [...players, createPlayer(KEEPER_IDS.gold, 'gold', undefined, true), createPlayer(KEEPER_IDS.red, 'red', undefined, true)];
  const b = CONFIG.ball;
  const { width, goalWidth } = CONFIG.pitch;
  const post = (x: number, y: number): Disc => ({
    x, y, ...still(), r: CONFIG.post.radius, invMass: 0, damping: 1, bounce: CONFIG.post.bounce,
  });
  const match: Match = {
    players,
    ball: { x: 0, y: 0, ...still(), r: b.radius, invMass: b.invMass, damping: b.damping, bounce: b.bounce },
    posts: [-1, 1].flatMap(sx => [-1, 1].map(sy => post(sx * width / 2, sy * goalWidth / 2))),
    owner: null,
    pullingIn: 0,
    score: { gold: 0, red: 0 },
    restartIn: 0,
    kickoffTeam: opts.kickoff ?? 'gold',
    holdFor: opts.coin ? CONFIG.coinTime : 0,
    coinPending: !!opts.coin,
    kickoffHeld: true,
    practice: !!opts.practice,
    seed: opts.seed ?? Math.floor(Math.random() * 2 ** 32),
    rules: opts.rules ?? { kind: 'endless' },
    clock: 0,
    goals: [],
    lastTouch: null,
    over: null,
    spin: 0,
    curled: 0,
    aftertouch: null,
    guard: null,
  };
  kickoff(match);
  if (match.practice) {
    match.kickoffHeld = false;
    match.owner = null;
  }
  return match;
}

// Ball on the spot, each team lined up in its own half facing the other.
export function kickoff(match: Match) {
  Object.assign(match.ball, { x: 0, y: 0, ...still() });
  match.owner = null;
  match.pullingIn = 0;
  match.kickoffHeld = true;
  for (const team of ['gold', 'red'] as const) {
    match.players.filter(p => p.team === team && !p.keeper).forEach((p, i, mine) => {
      Object.assign(p, {
        ...formation(team, i, mine.length), ...still(),
        action: 'none', actionT: 0, charge: 0, cooldown: 0,
      });
    });
  }
  for (const p of match.players) {
    if (!p.keeper) continue;
    const { side, line } = keeperBox(p);
    Object.assign(p, { x: line - side * CONFIG.keeper.lineOff, y: 0, fx: -side, fy: 0, ...still(), action: 'none', actionT: 0, charge: 0, cooldown: 0 });
    p.keeperState = undefined;
  }
  // Whoever of the kicking team stands nearest the spot steps up to it,
  // already on the ball.
  const kicker = match.players
    .filter(p => p.team === match.kickoffTeam && !p.keeper)
    .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0];
  if (kicker) {
    const side = kicker.team === 'gold' ? -1 : 1;
    Object.assign(kicker, { x: side * CONFIG.dribble.distance, y: 0, fx: -side, fy: 0 });
    match.owner = kicker.id;
  }
}

// Kickoff spot for the i-th of n players on a team: columns of up to four
// across the pitch, each further back towards their own goal.
function formation(team: Team, i: number, n: number) {
  const side = team === 'gold' ? -1 : 1;
  const col = Math.floor(i / FORMATION_ROWS);
  const row = i % FORMATION_ROWS;
  const inCol = Math.min(FORMATION_ROWS, n - col * FORMATION_ROWS);
  return {
    x: side * (CONFIG.pitch.width / 4 + col * 3),
    y: (row - (inCol - 1) / 2) * 3.6,
    fx: -side,
    fy: 0,
  };
}
const FORMATION_ROWS = 4;

// A player joining a match in progress starts on their own goal line.
export function addPlayer(match: Match, p: Player) {
  const side = p.team === 'gold' ? -1 : 1;
  const others = match.players.filter(q => q.team === p.team).length;
  Object.assign(p, { x: side * (CONFIG.pitch.width / 2 - 1.5), y: ((others % 5) - 2) * 2, fx: -side, fy: 0 });
  match.players.push(p);
}

export function step(match: Match, inputs: Record<string, Input>): SimEvent[] {
  const events: SimEvent[] = [];
  const dt = CONFIG.tick;
  const { ball } = match;
  const byId = (id: string | null) => match.players.find(p => p.id === id);

  if (match.coinPending) {
    match.coinPending = false;
    events.push({ type: 'coin', team: match.kickoffTeam });
  }
  if (match.over) return events;
  if (match.holdFor > 0) {
    match.holdFor = Math.max(0, match.holdFor - dt);
    // Buttons held through the toss don't fire the moment it ends.
    for (const p of match.players) {
      const input = inputs[p.id] ?? NO_INPUT;
      p.kickDown = input.kick;
      p.sprintDown = input.sprint;
    }
    return events;
  }

  if (match.restartIn <= 0 && !match.practice) match.clock += dt;
  for (const p of match.players) {
    // Keepers think for themselves, unless someone's steering them.
    let input = inputs[p.id];
    if (!input && p.keeper) {
      const move = keeperInput(match, p, () => random(match));
      if (move.dive && p.action === 'none') dive(p, move.dive, events);
      input = move.input;
    }
    control(match, p, input ?? NO_INPUT, events);
  }

  for (const p of match.players) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  const owner = byId(match.owner);
  if (owner) {
    // The ball is pulled to a spot ahead of the dribbler's feet.
    const tx = owner.x + owner.fx * holdDistance(owner);
    const ty = owner.y + owner.fy * holdDistance(owner);
    ball.vx = owner.vx + (tx - ball.x) * CONFIG.dribble.spring;
    ball.vy = owner.vy + (ty - ball.y) * CONFIG.dribble.spring;
  }
  if (owner) {
    match.spin = 0;
  } else if (match.spin) {
    // Curl: the ball's path turns, the spin fading as it goes. However
    // hard it's curled, it bends so far and no further: full until most of
    // the way to maxTurn, then easing off, so it never loops round.
    const { maxTurn, turnEase } = CONFIG.kick;
    const left = Math.max(0, Math.min(1, (maxTurn - Math.abs(match.curled)) / (maxTurn * turnEase)));
    const a = match.spin * Math.hypot(ball.vx, ball.vy) * dt * left;
    match.curled += a;
    const { vx, vy } = ball;
    ball.vx = vx * Math.cos(a) - vy * Math.sin(a);
    ball.vy = vx * Math.sin(a) + vy * Math.cos(a);
    match.spin *= Math.exp(-CONFIG.kick.spinFade * dt);
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (!owner) {
    ball.vx *= ball.damping;
    ball.vy *= ball.damping;
  }
  const flight = { vx: ball.vx, vy: ball.vy };

  const players = match.players;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) collide(players[i]!, players[j]!);
    for (const post of match.posts) collide(players[i]!, post);
    // The dribbler's own body doesn't get in the ball's way; anyone else's
    // deadens it.
    // A keeper's ball is in its hands: nobody else touches it; nor, for a
    // moment after its kick out, does the other team. A hard shot comes
    // off a keeper rather than dying at its feet.
    const q = players[i]!;
    const guarded = match.guard && q.team !== match.guard.team;
    const parry = q.keeper && Math.hypot(ball.vx, ball.vy) > CONFIG.keeper.catchSpeed;
    if (q !== owner && !owner?.keeper && !guarded) {
      const before = ball.vx;
      collide(q, ball, parry ? CONFIG.keeper.parryBounce : CONFIG.ball.playerBounce);
      // Parried: loose, not caught on the rebound.
      if (parry && ball.vx !== before) q.cooldown = Math.max(q.cooldown, CONFIG.keeper.parryCooldown);
    }
  }
  // At someone's feet, a post or a line takes nearly all the pace off it:
  // the pull onto the foot points through them, and bounced back off them,
  // then lost, it would fly back into play like a shot.
  if (match.owner) ball.bounce = CONFIG.ball.heldBounce;
  for (const post of match.posts) collide(ball, post);

  for (const p of players) tackle(match, p, events);

  for (const p of players) keepPlayerIn(p);
  if (match.kickoffHeld) {
    if (Math.hypot(ball.x, ball.y) > CONFIG.kickoffPlayed) match.kickoffHeld = false;
    else for (const p of players) keepKickoffShape(p, p.team !== match.kickoffTeam);
  }
  keepBallIn(ball);
  ball.bounce = CONFIG.ball.bounce;
  // Anything it hits (a body, a post, a wall) takes the spin off it.
  if (Math.hypot(ball.vx - flight.vx, ball.vy - flight.vy) > 1) {
    match.spin = 0;
    match.aftertouch = null;
  }

  match.pullingIn = Math.max(0, match.pullingIn - dt);
  if (match.guard && (match.guard.left -= dt) <= 0) match.guard = null;
  const holder = byId(match.owner);
  if (holder && match.pullingIn === 0) {
    const gap = Math.hypot(
      ball.x - (holder.x + holder.fx * holdDistance(holder)),
      ball.y - (holder.y + holder.fy * holdDistance(holder)),
    );
    if (gap > holder.stats.loseDistance && !holder.keeper) loseBall(match, holder, CONFIG.dribble.lostCooldown);
  } else if (!holder && match.restartIn <= 0) {
    trap(match, events);
  }
  if (match.owner) match.lastTouch = match.owner;

  if (match.restartIn > 0) {
    match.restartIn -= dt;
    if (match.restartIn <= 0) {
      match.restartIn = 0;
      kickoff(match);
      events.push({ type: 'kickoff' });
    }
  } else if (!match.practice) {
    const team = goalScoredBy(ball);
    if (team) {
      match.score[team]++;
      match.kickoffTeam = team === 'gold' ? 'red' : 'gold';
      match.restartIn = CONFIG.restartDelay;
      match.owner = null;
      const scorer = match.lastTouch;
      const by = match.players.find(p => p.id === scorer);
      const goal: GoalRecord = { team, scorer, own: !!by && by.team !== team, at: match.clock };
      match.goals.push(goal);
      events.push({ type: 'goal', ...goal });
    }
    endIfWon(match, events);
  }

  return events;
}

// A keeper throwing itself at a shot: a slide that way, turned to face it,
// so it catches the ball if it meets it square and parries it otherwise.
function dive(p: Player, to: { x: number; y: number }, events: SimEvent[]) {
  setAction(p, 'slide');
  p.fx = to.x;
  p.fy = to.y;
  p.vx = to.x * CONFIG.keeper.diveSpeed;
  p.vy = to.y * CONFIG.keeper.diveSpeed;
  events.push({ type: 'slide', player: p.id });
}

// First to the target, or ahead when the clock runs out; level at full
// time, the next goal wins.
function endIfWon(match: Match, events: SimEvent[]) {
  const { rules, score } = match;
  const leader: Team | null = score.gold > score.red ? 'gold' : score.red > score.gold ? 'red' : null;
  const won =
    (rules.kind === 'first' && leader !== null && score[leader] >= rules.goals) ||
    (rules.kind === 'timed' && leader !== null && match.clock >= rules.seconds);
  if (!won) return;
  match.over = { winner: leader };
  match.restartIn = 0;
  events.push({ type: 'end', winner: leader, score: { ...score }, goals: match.goals.map(g => ({ ...g })) });
}

function setAction(p: Player, action: Action) {
  p.action = action;
  p.actionT = 0;
  p.struck = false;
}

function loseBall(match: Match, p: Player, cooldown: number) {
  if (match.owner !== p.id) return;
  match.owner = null;
  p.cooldown = cooldown;
  if (p.action === 'charge') setAction(p, 'none');
  p.charge = 0;
}

// The button, timers, stamina, facing and velocity for one player.
function control(match: Match, p: Player, input: Input, events: SimEvent[]) {
  const dt = CONFIG.tick;
  const { tackle, kick } = CONFIG;
  const pressed = input.kick && !p.kickDown;
  const released = !input.kick && p.kickDown;
  const sprintPressed = input.sprint && !p.sprintDown;
  p.kickDown = input.kick;
  p.sprintDown = input.sprint;
  p.actionT += dt;
  p.cooldown = Math.max(0, p.cooldown - dt);
  const hasBall = match.owner === p.id;

  switch (p.action) {
    case 'none':
      if (!pressed) break;
      if (hasBall) {
        setAction(p, 'charge');
      } else if (inPokeRange(match, p)) {
        setAction(p, 'poke');
        p.vx += p.fx * tackle.pokeLunge;
        p.vy += p.fy * tackle.pokeLunge;
        events.push({ type: 'poke', player: p.id });
      } else {
        setAction(p, 'slide');
        p.vx = p.fx * tackle.slideSpeed;
        p.vy = p.fy * tackle.slideSpeed;
        events.push({ type: 'slide', player: p.id });
      }
      break;
    case 'charge':
      p.charge = Math.min(1, p.actionT / p.stats.chargeTime);
      if (sprintPressed) {
        // A dummy: the kick is called off, the ball kept.
        p.charge = 0;
        setAction(p, 'none');
        events.push({ type: 'feint', player: p.id });
      } else if (released) {
        const speed = kick.passSpeed + (p.stats.shotSpeed - kick.passSpeed) * p.charge;
        match.ball.vx = p.fx * speed;
        match.ball.vy = p.fy * speed;
        match.owner = null;
        match.spin = 0;
        match.curled = 0;
        // A keeper's kick out goes straight: walking off after it is no aftertouch.
        match.aftertouch = p.keeper ? null : { player: p.id, dx: p.fx, dy: p.fy, left: kick.aftertouch };
        if (p.keeper) match.guard = { team: p.team, left: CONFIG.keeper.kickGuard };
        p.cooldown = kick.cooldown;
        events.push({ type: 'kick', player: p.id, power: p.charge });
        p.charge = 0;
        setAction(p, 'none');
      }
      break;
    case 'poke':
      if (p.actionT >= tackle.pokeTime) setAction(p, 'none');
      break;
    case 'slide':
      if (p.actionT >= tackle.slideTime) setAction(p, 'recover');
      break;
    case 'recover':
      if (p.actionT >= tackle.recoverTime) setAction(p, 'none');
      break;
    case 'stumble':
      if (p.actionT >= p.stats.stumbleTime) setAction(p, 'none');
      break;
  }

  if (p.action === 'slide') {
    p.vx *= tackle.slideDamping;
    p.vy *= tackle.slideDamping;
    p.sprinting = false;
    return;
  }
  if (p.action === 'stumble') {
    p.vx *= 0.9;
    p.vy *= 0.9;
    p.sprinting = false;
    return;
  }

  const len = Math.hypot(input.x, input.y);
  const moving = len > 0;
  const dx = moving ? input.x / len : 0;
  const dy = moving ? input.y / len : 0;

  // Aftertouch: just after your kick, holding a direction across its path
  // curls it that way.
  const at = match.aftertouch;
  if (at?.player === p.id && at.left > 0) {
    at.left -= dt;
    // Which side of the kick's path you hold: anything 35 degrees or more
    // off it is a full curl that way (holding right on a kick up and right
    // curls it right), less only close to straight on or straight back.
    const held = Math.hypot(input.x, input.y);
    const sin = held ? (input.x * -at.dy + input.y * at.dx) / held : 0;
    const across = Math.sign(sin) * Math.min(1, Math.abs(sin) / 0.57);
    const build = (p.stats.curl / kick.curlBuild) * dt;
    match.spin = Math.max(-p.stats.curl, Math.min(p.stats.curl, match.spin + across * build));
  }

  // Stamina: sprinting drains it; running dry means a spell of being tired.
  const st = p.stats;
  if (p.tired > 0) {
    p.tired = Math.max(0, p.tired - dt);
    p.sprinting = false;
  } else {
    p.sprinting = input.sprint && moving && p.stamina > 0;
    if (p.sprinting) {
      p.stamina = Math.max(0, p.stamina - st.drain * dt);
      if (p.stamina === 0) {
        p.tired = st.tiredTime;
        p.sprinting = false;
      }
    } else {
      p.stamina = Math.min(1, p.stamina + st.regen * dt);
    }
  }

  const pl = CONFIG.player;
  let speed = p.tired > 0 ? pl.tiredSpeed : p.sprinting ? p.stats.sprintSpeed : p.stats.runSpeed;
  if (match.owner === p.id) speed *= p.stats.dribbleSpeed;
  if (p.action === 'charge') speed *= kick.moveFactor;
  if (p.action === 'recover') speed *= tackle.recoverFactor;

  const dribbling = match.owner === p.id;
  let mx = dx;
  let my = dy;
  if (moving && p.action === 'charge') {
    // Powering up a kick, you can't turn: you go on the way you face, and
    // the keys are free to set up the curl.
    mx = p.fx;
    my = p.fy;
  } else if (moving) {
    let rate = pl.turnRate;
    if (dribbling) {
      // Quicker to turn the slower you're going: a pivot when stopped, so
      // a reversal brakes, turns with the ball and goes, rather than
      // looping round at speed.
      const slow = 1 - Math.min(1, Math.hypot(p.vx, p.vy) / p.stats.runSpeed);
      rate = p.stats.turnRateWithBall * (1 + (CONFIG.dribble.pivotBoost - 1) * slow * slow);
    }
    const current = Math.atan2(p.fy, p.fx);
    const turn = angleBetween(current, Math.atan2(dy, dx));
    const a = current + Math.sign(turn) * Math.min(Math.abs(turn), rate * dt);
    p.fx = Math.cos(a);
    p.fy = Math.sin(a);
    if (dribbling) {
      // With the ball, a cut is a curve: moving across the way you're
      // pressing, you run where you face. Otherwise (moving away from it,
      // nearly stopped, or already going that way) you move along the line
      // you're pressing: turning back on yourself you slow along it, turn
      // with the ball on the spot and go back the way you came, rather than
      // looping round.
      const v = Math.hypot(p.vx, p.vy);
      const along = (p.vx * dx + p.vy * dy) / (v || 1);
      const across = v >= CONFIG.dribble.pivotSpeed && along > -0.5 && along < 0.7;
      if (across) {
        mx = p.fx;
        my = p.fy;
      }
      // Speed kept for the turn still to make: down to turnSlowdown at 90
      // degrees, then on down to reverseKeep for a full about turn.
      const left = Math.abs(turn) - Math.min(Math.abs(turn), rate * dt);
      const quarter = Math.PI / 2;
      // No sprinting round a turn back on yourself with the ball: running
      // pace at most.
      if (left > quarter) speed = Math.min(speed, p.stats.runSpeed * p.stats.dribbleSpeed);
      const { reverseKeep } = CONFIG.dribble;
      speed *= left <= quarter
        ? 1 - (1 - p.stats.turnSlowdown) * (left / quarter)
        : p.stats.turnSlowdown - (p.stats.turnSlowdown - reverseKeep) * Math.min(1, (left - quarter) / quarter);
    }
  }

  // Agility (from Dribbling) quickens a change of direction or a stop, not
  // speeding up straight on: none of it going the way you already are, all
  // of it for an about turn or letting go of the keys.
  const tx = mx * speed;
  const ty = my * speed;
  const v = Math.hypot(p.vx, p.vy);
  const t = v < 0.5 ? 0 : !moving ? 1 : (1 - (p.vx * mx + p.vy * my) / v) / 2;
  const k = Math.min(1, pl.response * (1 + (p.stats.agility - 1) * t) * dt);
  p.vx += (tx - p.vx) * k;
  p.vy += (ty - p.vy) * k;
}

// How far ahead of a dribbler the ball is held: further when sprinting,
// the more so the quicker they are.
const holdDistance = (p: Player) => CONFIG.dribble.distance + (p.sprinting ? p.stats.sprintTouch : 0);

// Whether a tackle pressed now is a poke: the ball is within a foot's reach,
// or the player on it is close enough to get round. Not from behind a
// dribbler, where a poke can't reach: that press is a slide instead.
function inPokeRange(match: Match, p: Player) {
  const { ball } = match;
  const owner = match.players.find(q => q.id === match.owner);
  if (owner && owner !== p && isBehind(owner, p)) return false;
  if (Math.hypot(ball.x - p.x, ball.y - p.y) - p.r - ball.r <= p.stats.pokeRange) return true;
  return !!owner && owner !== p && Math.hypot(owner.x - p.x, owner.y - p.y) - p.r - owner.r <= CONFIG.tackle.pokeBodyReach;
}

// A slide through the back of a dribbler: they're knocked off balance and
// the ball squirts on ahead of them, loose, while the slider on the ground
// can't trap it for a moment. A scramble rather than a clean steal, until
// there are fouls to pay for it.
function rearSlide(match: Match, p: Player, q: Player, events: SimEvent[]) {
  const t = CONFIG.tackle;
  events.push({ type: 'steal', player: p.id, from: q.id });
  loseBall(match, q, t.stealCooldown);
  match.lastTouch = p.id;
  match.ball.vx = q.fx * t.rearKnock + q.vx * 0.3;
  match.ball.vy = q.fy * t.rearKnock + q.vy * 0.3;
  p.cooldown = Math.max(p.cooldown, t.rearSlideCooldown);
  p.struck = true;
  setAction(q, 'stumble');
  q.vx += p.fx * p.stats.shove;
  q.vy += p.fy * p.stats.shove;
}

// A tackle that reaches a dribbler can be ridden: it wins with chance
// 0.85 × (tackling / strength)³, as multipliers, capped at 1. Level players
// win 85%; Strength 10 against a 5 rides about half; Strength 3 or less
// against a 5 never rides one.
function beatsHold(match: Match, p: Player, victim: Player) {
  const { holdBase, holdPower } = CONFIG.tackle;
  const chance = Math.min(1, holdBase * (p.stats.tackleFactor / victim.stats.holdFactor) ** holdPower);
  return chance >= 1 || random(match) < chance;
}

// The dribbler rides the challenge: the tackle is spent, the ball kept.
function shrug(p: Player, victim: Player, events: SimEvent[]) {
  p.struck = true;
  events.push({ type: 'shrug', player: victim.id, from: p.id });
}

// The match's own random numbers (mulberry32), so a seeded match replays the
// same. Only the host's sim draws them.
function random(match: Match) {
  let t = (match.seed = (match.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Whether p is in the arc behind a dribbler that their body shields.
function isBehind(dribbler: Player, p: Player) {
  const dx = p.x - dribbler.x;
  const dy = p.y - dribbler.y;
  const dist = Math.hypot(dx, dy) || 1;
  return (dribbler.fx * dx + dribbler.fy * dy) / dist < CONFIG.tackle.shieldCos;
}

// Pokes and slides reaching the ball, and slides taking players out.
function tackle(match: Match, p: Player, events: SimEvent[]) {
  const { tackle: t } = CONFIG;
  const { ball } = match;
  if (p.action !== 'poke' && p.action !== 'slide') return;
  if (p.struck || match.owner === p.id) return;

  // The ball's out of bounds to them just after a keeper's kick.
  if (match.guard && p.team !== match.guard.team) return;
  const poking = p.action === 'poke';
  const footX = p.x + p.fx * (p.r + (poking ? 0.3 : 0.2));
  const footY = p.y + p.fy * (p.r + (poking ? 0.3 : 0.2));
  const victim = match.players.find(q => q.id === match.owner);
  // A keeper holding the ball can't be tackled.
  if (victim?.keeper && victim !== p) return;
  // A keeper's dive reaches less far than a slide tackle.
  const reach = ball.r + (poking ? t.pokeReach * p.stats.tackleFactor : p.keeper ? CONFIG.keeper.diveReach : p.stats.slideReach);
  let ballHit = Math.hypot(ball.x - footX, ball.y - footY) < reach;
  // A poke also gets round the dribbler's body to a ball out of reach, as
  // long as the poker is facing them. Neither works from behind: a dribbler
  // can shield the ball from someone on their back.
  let bodyHit = false;
  if (poking && victim) {
    const dx = p.x - victim.x;
    const dy = p.y - victim.y;
    const dist = Math.hypot(dx, dy) || 1;
    const behind = isBehind(victim, p);
    bodyHit = !behind
      && dist < p.r + victim.r + t.pokeBodyReach * p.stats.tackleFactor
      && p.fx * -dx + p.fy * -dy > 0;
    if (behind) ballHit = false;
  }
  if (ballHit || bodyHit) {
    // A slide reaching the ball through a dribbler's back: see rearSlide.
    if (!poking && victim && isBehind(victim, p)) {
      rearSlide(match, p, victim, events);
      return;
    }
    if (victim && victim !== p && !beatsHold(match, p, victim)) {
      shrug(p, victim, events);
      return;
    }
    if (victim) {
      loseBall(match, victim, t.stealCooldown);
      events.push({ type: 'steal', player: p.id, from: victim.id });
    }
    match.lastTouch = p.id;
    if (poking) {
      // Knocked loose back towards the poker's feet, for them to collect.
      const dx = footX - ball.x;
      const dy = footY - ball.y;
      const len = Math.hypot(dx, dy) || 1;
      ball.vx = (dx / len) * t.pokeKnock + (victim?.vx ?? 0) * 0.3;
      ball.vy = (dy / len) * t.pokeKnock + (victim?.vy ?? 0) * 0.3;
    } else if (
      (p.fx * (ball.x - p.x) + p.fy * (ball.y - p.y)) / (Math.hypot(ball.x - p.x, ball.y - p.y) || 1)
        > p.stats.slideControlCos
      && !(p.keeper && Math.hypot(ball.vx, ball.vy) > CONFIG.keeper.catchSpeed)
    ) {
      // Slid straight into it: a controlled slide, the ball kept (a keeper
      // only holds on to one that isn't too hot to handle).
      match.owner = p.id;
      match.pullingIn = t.pullInTime;
      events.push({ type: 'trap', player: p.id });
    } else {
      // Clipped off to one side: knocked on ahead.
      ball.vx = p.fx * t.slideKnock + p.vx * 0.3;
      ball.vy = p.fy * t.slideKnock + p.vy * 0.3;
    }
    p.struck = true;
  }

  if (poking) return;
  for (const q of match.players) {
    if (q === p || q.action === 'stumble') continue;
    if (q.keeper && match.owner === q.id) continue;
    if (Math.hypot(q.x - p.x, q.y - p.y) > p.r + q.r + 0.1) continue;
    if (match.owner === q.id && isBehind(q, p)) {
      rearSlide(match, p, q, events);
      continue;
    }
    if (match.owner === q.id && !beatsHold(match, p, q)) {
      shrug(p, q, events);
      return;
    }
    if (match.owner === q.id) events.push({ type: 'steal', player: p.id, from: q.id });
    loseBall(match, q, t.stealCooldown);
    setAction(q, 'stumble');
    q.vx += p.fx * p.stats.shove;
    q.vy += p.fy * p.stats.shove;
  }
}

// A loose ball sticks to the nearest player who touches it, sliding or not.
function trap(match: Match, events: SimEvent[]) {
  const { ball } = match;
  let best: Player | null = null;
  let bestGap: number = CONFIG.dribble.reach;
  const speed = Math.hypot(ball.vx, ball.vy);
  const k = CONFIG.keeper;
  for (const p of match.players) {
    if (p.cooldown > 0 || p.action === 'stumble') continue;
    if (match.guard && p.team !== match.guard.team) continue;
    const gap = Math.hypot(ball.x - p.x, ball.y - p.y) - p.r - ball.r;
    // A keeper catches only what reaches its body, and nothing too hot to
    // hold; a slow ball it gathers from a little way off like anyone.
    if (p.keeper && (speed > k.catchSpeed || (speed > k.gatherSpeed && gap > 0.05))) continue;
    // Anyone else only takes one in front of them: one at their side or
    // back hits them and drops (their hands make a keeper the exception).
    // Taken from further round, the pull onto the foot would fling it.
    const dist = gap + p.r + ball.r || 1;
    if (!p.keeper && (p.fx * (ball.x - p.x) + p.fy * (ball.y - p.y)) / dist < CONFIG.dribble.trapCos) continue;
    if (gap <= bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  if (!best) return;
  match.owner = best.id;
  // A moment to draw it onto your foot before it can count as lost.
  match.pullingIn = CONFIG.tackle.pullInTime;
  events.push({ type: 'trap', player: best.id });
}

function angleBetween(from: number, to: number) {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

// bounce overrides the pair's restitution, which is otherwise the product
// of their own.
function collide(a: Disc, b: Disc, bounce = a.bounce * b.bounce) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const overlap = a.r + b.r - dist;
  const total = a.invMass + b.invMass;
  if (overlap <= 0 || dist === 0 || total === 0) return;
  const nx = dx / dist;
  const ny = dy / dist;
  a.x -= nx * overlap * (a.invMass / total);
  a.y -= ny * overlap * (a.invMass / total);
  b.x += nx * overlap * (b.invMass / total);
  b.y += ny * overlap * (b.invMass / total);
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const impulse = (-(1 + bounce) * vn) / total;
  a.vx -= nx * impulse * a.invMass;
  a.vy -= ny * impulse * a.invMass;
  b.vx += nx * impulse * b.invMass;
  b.vy += ny * impulse * b.invMass;
}

// Clamps one axis of a disc to [min, max], bouncing it back off the edge.
function wall(d: Disc, axis: 'x' | 'y', min: number, max: number) {
  const v = axis === 'x' ? 'vx' : 'vy';
  if (d[axis] < min) {
    d[axis] = min;
    if (d[v] < 0) d[v] = -d[v] * d.bounce;
  } else if (d[axis] > max) {
    d[axis] = max;
    if (d[v] > 0) d[v] = -d[v] * d.bounce;
  }
}

function keepPlayerIn(p: Player) {
  const { width, height, margin } = CONFIG.pitch;
  wall(p, 'x', -width / 2 - margin + p.r, width / 2 + margin - p.r);
  wall(p, 'y', -height / 2 - margin + p.r, height / 2 + margin - p.r);
  if (p.keeper) {
    // The big box, from just behind the line to its edge: it keeps to the
    // small one unless it's coming out (engine/keeper.ts).
    const { side, line, areaDepth, areaHalf } = keeperBox(p);
    const a = line + side * 0.2;
    const b = line - side * areaDepth;
    wall(p, 'x', Math.min(a, b), Math.max(a, b));
    wall(p, 'y', -areaHalf, areaHalf);
  }
}

// Before the kickoff is taken: own half only, and the defending team outside
// the centre circle.
function keepKickoffShape(p: Player, defending: boolean) {
  if (p.team === 'gold') wall(p, 'x', -Infinity, -p.r);
  else wall(p, 'x', p.r, Infinity);
  if (!defending) return;
  const min = CONFIG.pitch.centreCircle + p.r;
  const dist = Math.hypot(p.x, p.y);
  if (dist >= min) return;
  // Pushed back out to the circle, towards their own side if dead centre.
  const nx = dist > 1e-6 ? p.x / dist : p.team === 'gold' ? -1 : 1;
  const ny = dist > 1e-6 ? p.y / dist : 0;
  p.x = nx * min;
  p.y = ny * min;
  const inward = p.vx * nx + p.vy * ny;
  if (inward < 0) {
    p.vx -= inward * nx;
    p.vy -= inward * ny;
  }
}

// The pitch lines are walls for the ball, except the goal mouths, which open
// into a net. The posts are discs, so the corners of the mouth round off.
// Past the end line only counts as in the net within the mouth's width;
// anywhere else the line holds it, even when it's dribbled into.
function keepBallIn(ball: Disc) {
  const { width, height, goalWidth, goalDepth } = CONFIG.pitch;
  const half = width / 2;
  const goalHalf = goalWidth / 2;
  if (Math.abs(ball.x) > half && Math.abs(ball.y) < goalHalf) {
    wall(ball, 'y', -goalHalf + ball.r, goalHalf - ball.r);
    wall(ball, 'x', -half - goalDepth + ball.r, half + goalDepth - ball.r);
  } else {
    wall(ball, 'y', -height / 2 + ball.r, height / 2 - ball.r);
    if (Math.abs(ball.y) > goalHalf) wall(ball, 'x', -half + ball.r, half - ball.r);
  }
}

// A goal counts once the whole ball is over the line.
function goalScoredBy(ball: Disc): Team | null {
  const half = CONFIG.pitch.width / 2;
  if (ball.x > half + ball.r) return 'gold';
  if (ball.x < -half - ball.r) return 'red';
  return null;
}
