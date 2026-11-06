import { CONFIG } from '../config';
import { Bot } from '../engine/ai';
import { NO_INPUT, toward } from '../engine/input';
import { createMatch, createPlayer, goalScoredBy, KEEPER_IDS, setAction, step, type Input, type Match, type Player, type SimEvent } from '../engine/sim';
import { statsFor } from '../engine/stats';
import type { Attributes } from './attributes';
import { angleBetween } from '../math';

/** The tackling drill's dummy, drawn in its own kit. */
export const DUMMY_ID = 'dummy';

// The training ground: you on the pitch with five drills to feel your
// attributes by.
// - The duel box, far left: carry a ball in and a bot keeps challenging
//   you for it; count the challenges you shrug off. (Strength.)
// - The tackle dummy, near left: it stands on a ball, turning to face you;
//   count the tackles you win. (Tackling.)
// - The sprint lane, running up the right half: cross one gate and the
//   clock runs until you cross the other. (Pace, Stamina.)
// - The cone lane beside it: the same, weaving through cones. (Dribbling.)
// - The keeper in the right goal: shoot past it. It rolls the ball back to
//   you after a save or a goal. (Power.)
//
// The sim has one ball, so the others are props. Run into one with your feet
// free and it swaps places with the real one. The dummy's ball is a prop too
// until you step into its box without a ball, when it becomes the real one.

// A lane runs up and down the pitch, along y.
export interface Lane {
  name: string;
  x: number;
  // Half the lane's width; leave it and the run is called off.
  half: number;
  // Far gate, then near gate.
  gates: [number, number];
}

export interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

const GATE = 7.5;
export const SPRINT: Lane = { name: 'Sprint', x: 1.8, half: 1.3, gates: [-GATE, GATE] };
export const CONES: Lane = { name: 'Cones', x: 5.5, half: 1.6, gates: [-GATE, GATE] };
export const CONE_SPOTS = [-6, -3, 0, 3, 6].map(y => ({ x: CONES.x, y }));
export const CONE_RADIUS = 0.16;
// One above the other on the left half, clear of the attributes panel.
export const DUEL: Box = { x: -6, y: -4.3, hw: 4.6, hh: 3.7 };
export const TACKLE: Box = { x: -6, y: 4.3, hw: 4.6, hh: 3.7 };
export const DUMMY_SPOT = { x: -5.5, y: 4.3 };

// One in the duel box, one past the far gate of each lane (the names are
// by the near ones), and a row to shoot
// at the keeper with.
const PROP_SPOTS = [
  { x: -3.5, y: -2.5 },
  { x: SPRINT.x, y: -GATE - 1 },
  { x: CONES.x, y: -GATE - 1 },
  { x: 9, y: -2.5 },
  { x: 9, y: 0 },
  { x: 9, y: 2.5 },
];
// In the gap between the boxes and the lanes.
const ME_START = { x: -0.6, y: 0 };
const BALL_START = { x: 0.2, y: 0.9 };
// The bot gives a ball it won back after this long; the dummy gets its ball
// back this long after you win it, wherever it went.
const GIVE_BACK = 0.6;
const RESET = 1;
// How fast the dummy turns to face you, radians per second.
const DUMMY_TURN = 2.2;
// How long a ball sits in the net before the keeper has it, and how long
// the keeper holds one before rolling it back.
const NET_WAIT = 0.8;
const KEEPER_HOLD = 0.8;

const inBox = (b: Box, p: { x: number; y: number }) => Math.abs(p.x - b.x) < b.hw && Math.abs(p.y - b.y) < b.hh;

interface Run {
  from: number;
  t: number;
  // Whether you had the ball at your feet the whole way.
  withBall: boolean;
}

export interface LaneResult {
  time: number;
  withBall: boolean;
}

export interface TrainingStats {
  lanes: { name: string; running: number | null; last: LaneResult | null; best: { with: number | null; without: number | null } }[];
  // Challenges the bot made while you held the ball in the duel box, and
  // how many took it off you; how long you've kept it, and the best.
  duel: { challenges: number; lost: number; held: number | null; best: number | null };
  tackle: { pokes: number; pokesWon: number; slides: number; slidesWon: number };
  // Your shots the keeper had to deal with, how many went in, and how many
  // it kept out (counted once each is over).
  keeper: { shots: number; goals: number; saves: number };
}

export class Training {
  readonly match: Match;
  readonly props = PROP_SPOTS.map(p => ({ ...p }));
  private me: Player;
  private bot: Player;
  private dummy: Player;
  private keeper: Player;
  private brain = new Bot('bot');
  // Whether the dummy has a ball: the real one (it owns it) or its prop.
  private dummyArmed = true;
  private dummyReset = 0;
  private runs = new Map<Lane, Run>();
  private results = new Map<Lane, TrainingStats['lanes'][number]>();
  private duel: TrainingStats['duel'] = { challenges: 0, lost: 0, held: null, best: null };
  private tackles: TrainingStats['tackle'] = { pokes: 0, pokesWon: 0, slides: 0, slidesWon: 0 };
  // The tackle in progress at the dummy, if any.
  private tackling: 'poke' | 'slide' | null = null;
  private botHeld = 0;
  private keeperStats: TrainingStats['keeper'] = { shots: 0, goals: 0, saves: 0 };
  // Your last shot, until someone else touches it: whether it's counted yet.
  private shot: { counted: boolean } | null = null;
  private inNet = 0;
  private keeperHeld = 0;
  private last = { ...ME_START };

  constructor(readonly id: string, attrs: Attributes) {
    this.me = createPlayer(id, 'gold', attrs);
    this.bot = createPlayer('bot', 'red');
    this.dummy = createPlayer(DUMMY_ID, 'red');
    this.keeper = createPlayer(KEEPER_IDS.red, 'red', undefined, true);
    this.match = createMatch([this.me, this.bot, this.dummy, this.keeper], { practice: true });
    Object.assign(this.me, { ...ME_START, vx: 0, vy: 0, fx: 1, fy: 0 });
    Object.assign(this.bot, { x: DUEL.x, y: DUEL.y, vx: 0, vy: 0, fx: -1, fy: 0 });
    Object.assign(this.dummy, { ...DUMMY_SPOT, vx: 0, vy: 0, fx: -1, fy: 0 });
    Object.assign(this.match.ball, { ...BALL_START, vx: 0, vy: 0 });
    for (const c of CONE_SPOTS) {
      this.match.posts.push({ ...c, vx: 0, vy: 0, r: CONE_RADIUS, invMass: 0, damping: 1, bounce: 0.3 });
    }
    for (const lane of [SPRINT, CONES]) {
      this.results.set(lane, { name: lane.name, running: null, last: null, best: { with: null, without: null } });
    }
  }

  /** New attributes, felt straight away. */
  setAttributes(attrs: Attributes) {
    this.me.stats = statsFor(attrs);
  }

  step(input: Input): SimEvent[] {
    this.tendDummy();
    const ownerBefore = this.match.owner;
    const inputs: Record<string, Input> = { [this.id]: input, bot: this.botInput(), dummy: this.dummyInput() };
    // Left to think for itself, except with the ball.
    const keeper = this.keeperInput();
    if (keeper) inputs[this.keeper.id] = keeper;
    const events = step(this.match, inputs);
    this.countShots(events);
    this.countTackles(events, ownerBefore);
    this.countChallenges(events);
    this.swapProps();
    this.timeLanes();
    this.last = { x: this.me.x, y: this.me.y };
    return events;
  }

  /** Every prop ball to draw: the loose ones, and the dummy's when it holds a prop. */
  drawnProps() {
    const { dummy } = this;
    const holdsProp = this.dummyArmed && this.match.owner !== dummy.id;
    if (!holdsProp) return this.props;
    const d = CONFIG.dribble.distance;
    return [...this.props, { x: dummy.x + dummy.fx * d, y: dummy.y + dummy.fy * d }];
  }

  /** In the tackle box: where a press would still poke, the ball's centre within this of you. */
  pokeReach() {
    const { me } = this;
    if (!inBox(TACKLE, me)) return undefined;
    return { x: me.x, y: me.y, r: me.r + this.match.ball.r + me.stats.pokeRange };
  }

  // --- The duel box ----------------------------------------------------------

  // The bot only comes for a ball you carry into the duel box; otherwise it
  // waits in the middle. A ball it wins, it rolls back to you.
  private botInput(): Input {
    const { match, bot, me } = this;
    const idle = NO_INPUT;
    if (match.owner === bot.id) {
      this.botHeld += CONFIG.tick;
      if (this.botHeld >= GIVE_BACK) this.rollBack(bot, 1.5, 0.9, 6);
      return idle;
    }
    this.botHeld = 0;
    if (match.owner === me.id && inBox(DUEL, me)) return this.brain.think(match);
    // Keeps out of loose balls, so it doesn't take one you left lying.
    bot.cooldown = Math.max(bot.cooldown, 0.1);
    return toward(bot, DUEL.x, DUEL.y, false, 0.3);
  }

  private countChallenges(events: SimEvent[]) {
    const { duel, me, match } = this;
    for (const e of events) {
      if ((e.type === 'poke' || e.type === 'slide') && e.player === this.bot.id) duel.challenges++;
      if (e.type === 'steal' && e.player === this.bot.id && e.from === me.id) duel.lost++;
    }
    if (match.owner === me.id && inBox(DUEL, me)) {
      duel.held = (duel.held ?? 0) + CONFIG.tick;
      duel.best = Math.max(duel.best ?? 0, duel.held);
    } else {
      duel.held = null;
    }
  }

  // --- The keeper ------------------------------------------------------------

  // With the ball, it holds it a moment and rolls it back to you rather than
  // clearing it upfield (to the bot or the dummy, its teammates). A ball in
  // the net it picks out, a moment later.
  private keeperInput(): Input | null {
    const { match, keeper } = this;
    const { ball } = match;
    if (goalScoredBy(ball) === 'gold' && match.owner === null) {
      this.inNet += CONFIG.tick;
      if (this.inNet >= NET_WAIT) {
        this.inNet = 0;
        const d = CONFIG.dribble.distance;
        Object.assign(keeper, { fx: -1, fy: 0, vx: 0, vy: 0 });
        setAction(keeper, 'none');
        Object.assign(ball, { x: keeper.x - d, y: keeper.y, vx: 0, vy: 0 });
        match.owner = keeper.id;
        match.spin = 0;
        match.aftertouch = null;
      }
      return null;
    }
    this.inNet = 0;
    if (match.owner !== keeper.id) {
      this.keeperHeld = 0;
      return null;
    }
    this.keeperHeld += CONFIG.tick;
    if (this.keeperHeld >= KEEPER_HOLD) this.rollBack(keeper, 2, 0.8, 9);
    return NO_INPUT;
  }

  // The bot or the keeper lets go of the ball and rolls it to you: harder
  // the further you are (from speed plus perMetre a metre, up to most).
  private rollBack(from: Player, speed: number, perMetre: number, most: number) {
    const { match, me } = this;
    const { ball } = match;
    match.owner = null;
    from.cooldown = 1;
    const dx = me.x - ball.x;
    const dy = me.y - ball.y;
    const len = Math.hypot(dx, dy) || 1;
    const v = Math.min(most, speed + len * perMetre);
    ball.vx = (dx / len) * v;
    ball.vy = (dy / len) * v;
  }

  // A shot is one of your kicks the keeper reads as on target; a goal, any
  // ball of yours that ends up in its net.
  private countShots(events: SimEvent[]) {
    const { match, me, keeper, keeperStats } = this;
    // Over without going in: kept out, if it was on target.
    const over = () => {
      if (this.shot?.counted) keeperStats.saves++;
      this.shot = null;
    };
    for (const e of events) {
      if (e.type === 'kick' && e.player === me.id) {
        over();
        this.shot = { counted: false };
      }
    }
    if (!this.shot) return;
    // Picked up by anyone, the keeper included: over.
    if (match.owner) {
      over();
      return;
    }
    if (!this.shot.counted && keeper.keeperState?.shotSeen) {
      this.shot.counted = true;
      keeperStats.shots++;
    }
    if (goalScoredBy(match.ball) === 'gold') {
      // One that curled in without being read still counts as a shot.
      if (!this.shot.counted) keeperStats.shots++;
      keeperStats.goals++;
      this.shot = null;
    }
  }

  // --- The tackle dummy ------------------------------------------------------

  // It stands on its spot turning to face you, and never traps a ball by
  // itself: tendDummy hands it one.
  private dummyInput(): Input {
    const { dummy, me } = this;
    dummy.cooldown = Math.max(dummy.cooldown, 0.1);
    if (Math.hypot(dummy.x - DUMMY_SPOT.x, dummy.y - DUMMY_SPOT.y) > 0.3 && dummy.action === 'none') {
      return toward(dummy, DUMMY_SPOT.x, DUMMY_SPOT.y, false, 0.3);
    }
    const want = Math.atan2(me.y - dummy.y, me.x - dummy.x);
    const now = Math.atan2(dummy.fy, dummy.fx);
    const turn = angleBetween(now, want);
    const a = now + Math.sign(turn) * Math.min(Math.abs(turn), DUMMY_TURN * CONFIG.tick);
    dummy.fx = Math.cos(a);
    dummy.fy = Math.sin(a);
    return NO_INPUT;
  }

  // Swaps the real ball in and out of the dummy's feet, and gives it the
  // ball back a moment after you win it.
  private tendDummy() {
    const { match, me, dummy } = this;
    const meIn = inBox(TACKLE, me);
    const dummyHasReal = match.owner === dummy.id;
    if (this.dummyArmed && !dummyHasReal && meIn && match.owner === null) {
      // You came to tackle: its ball becomes the real one, and the real one
      // is left as a prop where it was.
      const { x, y } = match.ball;
      this.props.push({ x, y });
      this.giveDummy();
    } else if (dummyHasReal && !meIn && this.props.length > 0) {
      // You left: the prop nearest you becomes the real ball, and the dummy
      // keeps a prop.
      const near = this.props.reduce((a, b) => (Math.hypot(b.x - me.x, b.y - me.y) < Math.hypot(a.x - me.x, a.y - me.y) ? b : a));
      this.props.splice(this.props.indexOf(near), 1);
      match.owner = null;
      Object.assign(match.ball, { x: near.x, y: near.y, vx: 0, vy: 0 });
    } else if (!this.dummyArmed) {
      // Won off it: while you're still in its box, a moment later the ball
      // is back at its feet, even from yours, ready for the next go. Carry
      // it out and it waits for you to come back.
      this.dummyReset = meIn ? this.dummyReset + CONFIG.tick : 0;
      if (this.dummyReset >= RESET) {
        this.dummyReset = 0;
        if (match.owner === me.id) {
          me.cooldown = Math.max(me.cooldown, 0.4);
          // A kick being charged is called off with the ball gone.
          if (me.action === 'charge') setAction(me, 'none');
          me.charge = 0;
        }
        this.giveDummy();
      }
    }
  }

  private giveDummy() {
    const { match, dummy } = this;
    const d = CONFIG.dribble.distance;
    Object.assign(match.ball, { x: dummy.x + dummy.fx * d, y: dummy.y + dummy.fy * d, vx: 0, vy: 0 });
    match.owner = dummy.id;
    this.dummyArmed = true;
  }

  private countTackles(events: SimEvent[], ownerBefore: string | null) {
    const { tackles, me, dummy, match } = this;
    for (const e of events) {
      if ((e.type === 'poke' || e.type === 'slide') && e.player === me.id && ownerBefore === dummy.id) {
        this.tackling = e.type;
        tackles[e.type === 'poke' ? 'pokes' : 'slides']++;
      }
    }
    const won = ownerBefore === dummy.id && match.owner !== dummy.id;
    if (won) {
      this.dummyArmed = false;
      if (this.tackling === 'poke') tackles.pokesWon++;
      if (this.tackling === 'slide') tackles.slidesWon++;
    }
    if (me.action !== 'poke' && me.action !== 'slide') this.tackling = null;
  }

  // --- Props and lanes -------------------------------------------------------

  // Your feet free and touching a prop ball: it becomes the real one, and
  // the real one is left as a prop where it lies.
  private swapProps() {
    const { match, me } = this;
    if (match.owner || me.cooldown > 0) return;
    const reach = me.r + match.ball.r + CONFIG.dribble.reach;
    for (const prop of this.props) {
      if (Math.hypot(prop.x - me.x, prop.y - me.y) > reach) continue;
      if (Math.hypot(match.ball.x - me.x, match.ball.y - me.y) <= reach) return;
      const { x, y } = match.ball;
      Object.assign(match.ball, { x: prop.x, y: prop.y, vx: 0, vy: 0 });
      Object.assign(prop, { x, y });
      return;
    }
  }

  private timeLanes() {
    const { me, last } = this;
    const hasBall = this.match.owner === me.id;
    for (const lane of [SPRINT, CONES]) {
      const result = this.results.get(lane)!;
      const run = this.runs.get(lane);
      const inLane = Math.abs(me.x - lane.x) <= lane.half;
      if (run) {
        run.t += CONFIG.tick;
        run.withBall &&= hasBall;
        result.running = run.t;
        if (!inLane) {
          this.runs.delete(lane);
          result.running = null;
          continue;
        }
      }
      for (const [i, gy] of lane.gates.entries()) {
        const crossed = (last.y - gy) * (me.y - gy) < 0 || (last.y !== me.y && me.y === gy);
        if (!crossed || !inLane) continue;
        if (run && run.from !== i) {
          const done = { time: run.t, withBall: run.withBall };
          result.last = done;
          const key = done.withBall ? 'with' : 'without';
          result.best[key] = Math.min(result.best[key] ?? Infinity, done.time);
          this.runs.delete(lane);
          result.running = null;
        } else {
          // Through a gate heading into the lane: the clock starts. Crossing
          // the same gate again starts it over.
          const inward = i === 0 ? me.y > gy : me.y < gy;
          if (inward) {
            this.runs.set(lane, { from: i, t: 0, withBall: hasBall });
            result.running = 0;
          } else {
            this.runs.delete(lane);
            result.running = null;
          }
        }
      }
    }
  }

  stats(): TrainingStats {
    return { lanes: [...this.results.values()], duel: this.duel, tackle: this.tackles, keeper: this.keeperStats };
  }
}
