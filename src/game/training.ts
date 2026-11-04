import { CONFIG } from '../config';
import { Bot } from '../engine/ai';
import { createMatch, createPlayer, step, type Input, type Match, type Player, type SimEvent } from '../engine/sim';
import { statsFor } from '../engine/stats';
import type { Attributes } from './attributes';

// The training ground: you on the pitch with four drills to feel your
// attributes by.
// - The sprint lane along the far side: cross one gate and the clock runs
//   until you cross the other. (Pace, Stamina.)
// - The cone lane along the near side: the same, weaving through cones.
//   (Dribbling.)
// - The duel box on the left: carry a ball in and a bot keeps challenging
//   you for it; count the challenges you shrug off. (Strength.)
// - The tackle dummy on the right: it stands on a ball, turning to face you;
//   count the tackles you win. (Tackling.)
//
// The sim has one ball, so the others are props. Run into one with your feet
// free and it swaps places with the real one. The dummy's ball is a prop too
// until you step into its box without a ball, when it becomes the real one.

export interface Lane {
  name: string;
  y: number;
  // Half the lane's width; leave it and the run is called off.
  half: number;
  gates: [number, number];
}

export interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

const GATE = 10;
export const SPRINT: Lane = { name: 'Sprint', y: -6.3, half: 1.3, gates: [-GATE, GATE] };
export const CONES: Lane = { name: 'Cones', y: 6.3, half: 1.6, gates: [-GATE, GATE] };
export const CONE_SPOTS = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5].map(x => ({ x, y: CONES.y }));
export const CONE_RADIUS = 0.16;
// Side by side between the lanes.
export const DUEL: Box = { x: -5.5, y: 0, hw: 4.3, hh: 4 };
export const TACKLE: Box = { x: 5.5, y: 0, hw: 4.3, hh: 4 };
export const DUMMY_SPOT = { x: 6.5, y: 0 };

// Beyond the gates, either side, and one in the duel box.
const PROP_SPOTS = [
  { x: -11.5, y: -2.5 },
  { x: -11.5, y: 2.5 },
  { x: -3.5, y: 2 },
  { x: 11.5, y: -2.5 },
  { x: 11.5, y: 2.5 },
];
const ME_START = { x: -12.5, y: 0 };
const BALL_START = { x: -11.5, y: 0 };
// The bot gives a ball it won back after this long; the dummy picks up a
// loose ball lying in its box after this long.
const GIVE_BACK = 0.6;
const PICK_UP = 0.8;
// How fast the dummy turns to face you, radians per second.
const DUMMY_TURN = 2.2;

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
}

export class Training {
  readonly match: Match;
  readonly props = PROP_SPOTS.map(p => ({ ...p }));
  private me: Player;
  private bot: Player;
  private dummy: Player;
  private brain = new Bot('bot');
  // Whether the dummy has a ball: the real one (it owns it) or its prop.
  private dummyArmed = true;
  private dummyLoose = 0;
  private runs = new Map<Lane, Run>();
  private results = new Map<Lane, TrainingStats['lanes'][number]>();
  private duel: TrainingStats['duel'] = { challenges: 0, lost: 0, held: null, best: null };
  private tackles: TrainingStats['tackle'] = { pokes: 0, pokesWon: 0, slides: 0, slidesWon: 0 };
  // The tackle in progress at the dummy, if any.
  private tackling: 'poke' | 'slide' | null = null;
  private botHeld = 0;
  private last = { ...ME_START };

  constructor(readonly id: string, attrs: Attributes) {
    this.me = createPlayer(id, 'gold', attrs);
    this.bot = createPlayer('bot', 'red');
    this.dummy = createPlayer('dummy', 'red');
    this.match = createMatch([this.me, this.bot, this.dummy], { practice: true });
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
    const events = step(this.match, { [this.id]: input, bot: this.botInput(), dummy: this.dummyInput() });
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
    const idle = { x: 0, y: 0, kick: false, sprint: false };
    if (match.owner === bot.id) {
      this.botHeld += CONFIG.tick;
      if (this.botHeld >= GIVE_BACK) {
        match.owner = null;
        bot.cooldown = 1;
        const dx = me.x - match.ball.x;
        const dy = me.y - match.ball.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = Math.min(6, 1.5 + len * 0.9);
        match.ball.vx = (dx / len) * speed;
        match.ball.vy = (dy / len) * speed;
      }
      return idle;
    }
    this.botHeld = 0;
    if (match.owner === me.id && inBox(DUEL, me)) return this.brain.think(match);
    // Keeps out of loose balls, so it doesn't take one you left lying.
    bot.cooldown = Math.max(bot.cooldown, 0.1);
    return this.walkTo(bot, DUEL);
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

  // --- The tackle dummy ------------------------------------------------------

  // It stands on its spot turning to face you, and never traps a ball by
  // itself: tendDummy hands it one.
  private dummyInput(): Input {
    const { dummy, me } = this;
    dummy.cooldown = Math.max(dummy.cooldown, 0.1);
    if (Math.hypot(dummy.x - DUMMY_SPOT.x, dummy.y - DUMMY_SPOT.y) > 0.3 && dummy.action === 'none') {
      return this.walkTo(dummy, DUMMY_SPOT);
    }
    const want = Math.atan2(me.y - dummy.y, me.x - dummy.x);
    const now = Math.atan2(dummy.fy, dummy.fx);
    const turn = Math.atan2(Math.sin(want - now), Math.cos(want - now));
    const a = now + Math.sign(turn) * Math.min(Math.abs(turn), DUMMY_TURN * CONFIG.tick);
    dummy.fx = Math.cos(a);
    dummy.fy = Math.sin(a);
    return { x: 0, y: 0, kick: false, sprint: false };
  }

  // Swaps the real ball in and out of the dummy's feet, and has it pick up a
  // ball left lying in its box.
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
      // Won off it: once the ball lies loose in its box, it takes it back.
      const loose = match.owner === null && inBox(TACKLE, match.ball);
      this.dummyLoose = loose ? this.dummyLoose + CONFIG.tick : 0;
      if (this.dummyLoose >= PICK_UP) {
        this.dummyLoose = 0;
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

  private walkTo(p: Player, to: { x: number; y: number }): Input {
    const dx = to.x - p.x;
    const dy = to.y - p.y;
    const len = Math.hypot(dx, dy);
    return len < 0.3 ? { x: 0, y: 0, kick: false, sprint: false } : { x: dx / len, y: dy / len, kick: false, sprint: false };
  }

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
      const inLane = Math.abs(me.y - lane.y) <= lane.half;
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
      for (const [i, gx] of lane.gates.entries()) {
        const crossed = (last.x - gx) * (me.x - gx) < 0 || (last.x !== me.x && me.x === gx);
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
          const inward = i === 0 ? me.x > gx : me.x < gx;
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
    return { lanes: [...this.results.values()], duel: this.duel, tackle: this.tackles };
  }
}
