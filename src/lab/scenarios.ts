import { CONFIG } from '../config';
import { NO_INPUT, toward } from '../engine/input';
import { createMatch, createPlayer, homeSide, KEEPER_IDS, step, type Input, type Match, type SimEvent, type Team } from '../engine/sim';
import { CONE_RADIUS } from '../game/training';
import { evenAttributes, type Attribute, type Attributes } from '../game/attributes';

// The lab's scenarios (hidden, at #/lab): a scene played out by scripted
// players on the real sim, so the only thing that changes between runs is
// the attributes and options picked. Each runs headless too, for repeats.

export interface Role {
  id: string;
  label: string;
  team: Team;
}

export interface Choice {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type Options = Record<string, string>;

/** One line of a readout: what, its value, and the attributes behind it. */
export interface Row {
  label: string;
  value: string;
  attrs?: Attribute[];
}

/** A block of the readout, titled; a player's in their team's colour. */
export interface Section {
  title: string;
  team?: Team;
  rows: Row[];
}

const row = (label: string, value: string, ...attrs: Attribute[]): Row => ({ label, value, attrs });

/** One run of a scenario: step it, read how it's going. */
export interface Run {
  match: Match;
  t: number;
  done: boolean;
  // How long it runs, if it's a set time.
  limit?: number;
  // Other matches going on beside the main one, each with its own ball.
  extra?: Match[];
  // Cones to draw.
  cones?: { x: number; y: number }[];
  // Kits to draw players in, where it isn't the team they play for.
  kits?: Record<string, Team>;
  // A shot's spot and where it's aimed, drawn as a draggable arrow.
  aim?: { x: number; y: number; tx: number; ty: number };
  step(): SimEvent[];
  readout(): Section[];
}

export interface Scenario {
  id: string;
  name: string;
  roles: Role[];
  choices: Choice[];
  // A line of help under the options.
  hint?: string;
  defaults: Options;
  start(attrs: Record<string, Attributes>, opts: Options, seed: number): Run;
  /** Over many seeds, what tends to happen; for scenarios with chance in them. */
  repeat?(attrs: Record<string, Attributes>, opts: Options, runs: number): Section[];
}

const { width, height } = CONFIG.pitch;
const s = (v: number) => `${v.toFixed(2)}s`;
const m = (v: number) => `${v.toFixed(1)}m`;

function labMatch(players: { role: Role; attrs: Attributes }[], seed: number) {
  const match = createMatch(players.map(p => createPlayer(p.role.id, p.role.team, p.attrs)), { practice: true, seed });
  match.kickoffHeld = false;
  match.owner = null;
  return match;
}

// --- Track ---------------------------------------------------------------
// Two runners side by side, sprinting end to end and turning at each end, so
// stamina runs out and comes back.

const RUNNERS: Role[] = [
  { id: 'a', label: 'Runner A', team: 'gold' },
  { id: 'b', label: 'Runner B', team: 'red' },
];
const TRACK_END = width / 2 - 1.5;

export const track: Scenario = {
  id: 'track',
  name: 'Track',
  roles: RUNNERS,
  choices: [
    { key: 'length', label: 'Run for', options: [['10', '10 s'], ['20', '20 s'], ['40', '40 s']].map(([value, label]) => ({ value: value!, label: label! })) },
    { key: 'sprint', label: 'Pace', options: [{ value: 'sprint', label: 'Sprint (hold)' }, { value: 'run', label: 'Run' }] },
  ],
  defaults: { length: '20', sprint: 'sprint' },
  start(attrs, opts) {
    const match = labMatch(RUNNERS.map(role => ({ role, attrs: attrs[role.id]! })), 1);
    // The ball out of the way, in a corner.
    Object.assign(match.ball, { x: -width / 2 + 0.5, y: height / 2 - 0.5 });
    const lanes = [-1.5, 1.5];
    const goal: Record<string, number> = {};
    const stat: Record<string, { dist: number; tired: number; top: number; at5: number | null; at10: number | null; legs: number }> = {};
    match.players.forEach((p, i) => {
      Object.assign(p, { x: -TRACK_END, y: lanes[i]!, fx: 1, fy: 0 });
      goal[p.id] = TRACK_END;
      stat[p.id] = { dist: 0, tired: 0, top: 0, at5: null, at10: null, legs: 0 };
    });
    const length = Number(opts.length);
    const sprint = opts.sprint === 'sprint';
    const run: Run = {
      match, t: 0, done: false, limit: length,
      step() {
        const inputs: Record<string, Input> = {};
        for (const p of match.players) {
          if (Math.abs(p.x - goal[p.id]!) < 0.6) {
            goal[p.id] = -goal[p.id]!;
            stat[p.id]!.legs++;
          }
          inputs[p.id] = toward(p, goal[p.id]!, p.y, sprint);
        }
        const before = new Map(match.players.map(p => [p.id, { x: p.x, y: p.y }]));
        const events = step(match, inputs);
        run.t += CONFIG.tick;
        for (const p of match.players) {
          const st = stat[p.id]!;
          const b = before.get(p.id)!;
          st.dist += Math.hypot(p.x - b.x, p.y - b.y);
          st.top = Math.max(st.top, Math.hypot(p.vx, p.vy));
          if (p.tired > 0) st.tired += CONFIG.tick;
          if (st.at5 === null && run.t >= 5) st.at5 = st.dist;
          if (st.at10 === null && run.t >= 10) st.at10 = st.dist;
        }
        if (run.t >= length) run.done = true;
        return events;
      },
      readout() {
        const [a, b] = RUNNERS.map(r => stat[r.id]!.dist);
        const lead = a === b ? 'level' : `${a! > b! ? RUNNERS[0]!.label : RUNNERS[1]!.label} by ${m(Math.abs(a! - b!))}`;
        const sections: Section[] = [{ title: 'Run', rows: [row('Ahead', lead)] }];
        for (const role of RUNNERS) {
          const p = match.players.find(q => q.id === role.id)!;
          const st = stat[role.id]!;
          sections.push({
            title: role.label, team: role.team, rows: [
              row('Speed', `${Math.hypot(p.vx, p.vy).toFixed(2)} m/s`, 'pace'),
              row('Top speed', `${st.top.toFixed(2)} m/s`, 'pace'),
              row('Stamina', `${Math.round(p.stamina * 100)}%${p.tired > 0 ? `, tired ${s(p.tired)}` : p.sprinting ? ', sprinting' : ''}`, 'stamina', 'pace'),
              row('Covered', `${m(st.dist)} (5s ${st.at5 === null ? '-' : m(st.at5)}, 10s ${st.at10 === null ? '-' : m(st.at10)})`, 'pace', 'stamina'),
              row('Time tired', `${s(st.tired)} over ${st.legs} turns`, 'stamina'),
            ],
          });
        }
        return sections;
      },
    };
    return run;
  },
};

// --- Arena ---------------------------------------------------------------
// A dribbler with the ball, and a tackler coming in from a chosen side. After
// the challenge both go for the ball, to show who gets it back.

const ARENA_ROLES: Role[] = [
  { id: 'dribbler', label: 'Dribbler', team: 'gold' },
  { id: 'tackler', label: 'Tackler', team: 'red' },
];
// How long after the challenge to keep watching.
const AFTER = 3;

type Outcome = 'won' | 'ridden' | 'penalized' | 'missed';

interface ArenaState {
  outcome: Outcome | null;
  tackle: 'poke' | 'slide' | null;
  at: number | null;
  down: Record<string, number>;
  regained: { by: string; at: number } | null;
}

export const arena: Scenario = {
  id: 'arena',
  name: 'Arena',
  roles: ARENA_ROLES,
  choices: [
    {
      key: 'from', label: 'Tackle from',
      options: [['0', 'Front'], ['45', 'Front side'], ['90', 'Side'], ['135', 'Back side'], ['180', 'Behind']].map(([value, label]) => ({ value: value!, label: label! })),
    },
    { key: 'kind', label: 'Tackle', options: [{ value: 'slide', label: 'Slide' }, { value: 'poke', label: 'Poke' }] },
    { key: 'move', label: 'Dribbler', options: [['stand', 'Standing'], ['run', 'Running'], ['sprint', 'Sprinting']].map(([value, label]) => ({ value: value!, label: label! })) },
  ],
  defaults: { from: '90', kind: 'slide', move: 'run' },
  start(attrs, opts, seed) {
    const match = labMatch(ARENA_ROLES.map(role => ({ role, attrs: attrs[role.id]! })), seed);
    const [dribbler, tackler] = match.players as [Match['players'][number], Match['players'][number]];
    const moving = opts.move !== 'stand';
    const sprint = opts.move === 'sprint';
    const speed = !moving ? 0 : sprint ? dribbler.stats.sprintSpeed : dribbler.stats.runSpeed;
    // Left of centre, clear of the lab's panel, with room to run on.
    Object.assign(dribbler, { x: moving ? -width / 2 + 8 : -2, y: 0, fx: 1, fy: 0, vx: speed, vy: 0 });
    Object.assign(match.ball, { x: dribbler.x + CONFIG.dribble.distance, y: 0, vx: speed, vy: 0 });
    match.owner = dribbler.id;
    // The tackler starts on a circle round where the dribbler will be in a
    // moment, at the angle picked from the way they're going.
    const lead = moving ? speed * 0.6 : 0;
    const a = (Number(opts.from) * Math.PI) / 180;
    const r = opts.kind === 'poke' ? 3.5 : 5;
    const cx = dribbler.x + lead;
    Object.assign(tackler, { x: cx + Math.cos(a) * r, y: Math.sin(a) * r });
    const fx = cx - tackler.x;
    const fy = -tackler.y;
    const len = Math.hypot(fx, fy) || 1;
    Object.assign(tackler, { fx: fx / len, fy: fy / len });

    const st: ArenaState = { outcome: null, tackle: null, at: null, down: { dribbler: 0, tackler: 0 }, regained: null };
    // The press: a slide from a couple of metres from the ball, a poke from
    // close in; from behind, where the body's in the way, once close to it.
    const pressAt = opts.kind === 'poke' ? 1.1 : 2.4;
    const bodyAt = opts.kind === 'poke' ? 1.1 : 1.3;
    let pressed = false;
    let held = 0;

    const run: Run = {
      match, t: 0, done: false,
      step() {
        const ball = match.ball;
        const inputs: Record<string, Input> = {};
        const ballDist = Math.hypot(ball.x - tackler.x, ball.y - tackler.y);
        if (!pressed) {
          // Closing in on the ball, then pressing once.
          const lead = 0.15;
          const go = toward(tackler, ball.x + ball.vx * lead, ball.y + ball.vy * lead, true, 0);
          const dx = tackler.x - dribbler.x;
          const dy = tackler.y - dribbler.y;
          const bodyDist = Math.hypot(dx, dy);
          const behind = dribbler.fx * dx + dribbler.fy * dy < -0.35 * bodyDist;
          if (bodyDist < bodyAt || (!behind && ballDist < pressAt)) {
            pressed = true;
            inputs.tackler = { ...go, kick: true };
          } else {
            inputs.tackler = go;
          }
        } else {
          inputs.tackler = st.at === null ? NO_INPUT : toward(tackler, ball.x, ball.y, true, 0);
        }
        // The dribbler carries on while they have it; then goes for it.
        if (match.owner === dribbler.id) inputs.dribbler = moving ? { x: 1, y: 0, kick: false, sprint } : NO_INPUT;
        else inputs.dribbler = toward(dribbler, ball.x, ball.y, true, 0);

        const events = step(match, inputs);
        run.t += CONFIG.tick;
        for (const e of events) {
          if (e.type === 'poke' || e.type === 'slide') st.tackle = e.type;
          if (st.outcome && st.outcome !== 'won') continue;
          if (e.type === 'penalized') st.outcome = 'penalized';
          else if (e.type === 'steal' && !st.outcome) st.outcome = 'won';
          else if (e.type === 'shrug') st.outcome = 'ridden';
          if (st.outcome && st.at === null) st.at = run.t;
        }
        for (const p of match.players) {
          if (st.at !== null && (p.action === 'stumble' || p.action === 'recover' || p.action === 'slide')) st.down[p.id]! += CONFIG.tick;
        }
        // The tackle ran its course without touching anything.
        if (pressed && st.at === null && st.tackle && tackler.action === 'none') {
          st.outcome = 'missed';
          st.at = run.t;
        }
        if (st.at !== null && st.outcome !== 'ridden' && !st.regained && match.owner) {
          st.regained = { by: match.owner, at: run.t - st.at };
        }
        if (st.at !== null && st.regained && match.owner === st.regained.by) held += CONFIG.tick;
        // Watched until the ball's settled and both are back on their feet.
        const down = match.players.some(p => p.action === 'stumble' || p.action === 'recover' || p.action === 'slide');
        if ((st.at !== null && run.t - st.at > AFTER && !down) || (st.regained && held > 0.5 && !down) || run.t > 8) run.done = true;
        return events;
      },
      readout() {
        const label = (id: string) => ARENA_ROLES.find(r => r.id === id)?.label ?? id;
        const challenge: Row[] = [
          row('Tackle', st.tackle ?? 'not yet'),
          row('Result', st.outcome ? OUTCOME[st.outcome] : '-', 'tackling', 'strength', 'dribbling'),
        ];
        if (st.outcome === 'penalized') {
          challenge.push(row('Penalty', `+${s(tackler.stats.recoverTime * (CONFIG.tackle.rearRecover - 1))} to get up`, 'strength'));
        }
        const ballTo = st.outcome === 'ridden' ? 'kept by the dribbler'
          : st.regained ? `${label(st.regained.by).toLowerCase()}, ${s(st.regained.at)} after`
            : st.at !== null ? 'loose' : '-';
        return [
          { title: 'Challenge', rows: challenge },
          {
            title: 'Off their feet', rows: [
              row('Dribbler', s(st.down.dribbler!), 'strength'),
              row('Tackler', s(st.down.tackler!), 'strength'),
            ],
          },
          {
            title: 'Ball', rows: [
              row('Back to', ballTo, 'pace'),
              row('Win odds', `${Math.round(holdOdds(tackler, dribbler) * 100)}% if it reaches`, 'tackling', 'strength', 'dribbling'),
              row('From behind', 'always wins, penalized'),
            ],
          },
        ];
      },
    };
    return run;
  },
  repeat(attrs, opts, runs) {
    const tally: Record<string, number> = {};
    const ball: Record<string, number> = { dribbler: 0, tackler: 0, loose: 0 };
    for (let seed = 1; seed <= runs; seed++) {
      const run = arena.start(attrs, opts, seed);
      let outcome: string | null = null;
      while (!run.done) {
        for (const e of run.step()) {
          if (e.type === 'penalized') outcome = 'penalized';
          else if (e.type === 'shrug') outcome ??= 'ridden';
          else if (e.type === 'steal') outcome ??= 'won';
        }
      }
      outcome ??= 'missed';
      tally[outcome] = (tally[outcome] ?? 0) + 1;
      const owner = run.match.owner;
      ball[owner ?? 'loose'] = (ball[owner ?? 'loose'] ?? 0) + 1;
    }
    const pct = (n: number) => `${Math.round((n / runs) * 100)}%`;
    return [{
      title: `${runs} runs`,
      rows: [
        ...(['won', 'ridden', 'penalized', 'missed'] as const).filter(k => tally[k]).map(k => row(OUTCOME[k], pct(tally[k]!))),
        row('Ball at the end', `dribbler ${pct(ball.dribbler!)}, tackler ${pct(ball.tackler!)}, loose ${pct(ball.loose!)}`),
      ],
    }];
  },
};

const OUTCOME: Record<Outcome, string> = {
  won: 'Tackle won',
  ridden: 'Ridden',
  penalized: 'Won, penalized',
  missed: 'Missed',
};

// The chance a challenge that reaches the dribbler wins, as the sim works it.
function holdOdds(tackler: Match['players'][number], dribbler: Match['players'][number]) {
  const { holdBase, holdPower } = CONFIG.tackle;
  return Math.min(1, holdBase * (tackler.stats.tackleFactor / (dribbler.stats.holdFactor * dribbler.stats.ballControl)) ** holdPower);
}


// --- Slalom --------------------------------------------------------------
// Two dribblers in lanes of cones side by side, each with their own ball
// (their own match, so they can't get in each other's way): weave through,
// carry on to the end, turn back on yourself.

const SLALOMERS: Role[] = [
  { id: 'a', label: 'Dribbler A', team: 'gold' },
  { id: 'b', label: 'Dribbler B', team: 'red' },
];
const LANE_Y = [-2.6, 2.6];
const SLALOM_START = -12;
const SLALOM_END = 11;
// How far either side of each cone the path goes.
const WEAVE = 0.9;

interface SlalomStat {
  wp: number;
  phase: 'lane' | 'turn' | 'back' | 'done';
  laneTime: number | null;
  turnAt: number | null;
  turnTime: number | null;
  minSpeed: number;
  widest: number;
  losses: number;
  path: number;
  lanePath: number | null;
}

export const slalom: Scenario = {
  id: 'slalom',
  name: 'Slalom',
  roles: SLALOMERS,
  choices: [
    { key: 'spacing', label: 'Cones', options: [{ value: '2.5', label: 'Tight (2.5 m)' }, { value: '3.5', label: 'Medium (3.5 m)' }, { value: '5', label: 'Wide (5 m)' }] },
    { key: 'pace', label: 'Pace', options: [{ value: 'run', label: 'Run' }, { value: 'sprint', label: 'Sprint (hold)' }] },
    { key: 'ball', label: 'Ball', options: [{ value: 'with', label: 'With the ball' }, { value: 'without', label: 'Without' }] },
  ],
  defaults: { spacing: '3.5', pace: 'run', ball: 'with' },
  start(attrs, opts) {
    const spacing = Number(opts.spacing);
    const sprint = opts.pace === 'sprint';
    const withBall = opts.ball === 'with';
    const coneXs: number[] = [];
    for (let x = SLALOM_START + 4; x <= SLALOM_END - 3; x += spacing) coneXs.push(x);
    const cones = LANE_Y.flatMap(y => coneXs.map(x => ({ x, y })));
    const matches = SLALOMERS.map((role, i) => {
      const m = labMatch([{ role, attrs: attrs[role.id]! }], 1);
      const y = LANE_Y[i]!;
      for (const x of coneXs) m.posts.push({ x, y, vx: 0, vy: 0, r: CONE_RADIUS, invMass: 0, damping: 1, bounce: 0.3 });
      const p = m.players[0]!;
      Object.assign(p, { x: SLALOM_START, y, fx: 1, fy: 0 });
      if (withBall) {
        Object.assign(m.ball, { x: p.x + CONFIG.dribble.distance, y });
        m.owner = p.id;
      } else {
        Object.assign(m.ball, { x: -width / 2 + 0.5, y: (i ? 1 : -1) * (height / 2 - 0.5) });
      }
      return m;
    });
    // The path: either side of each cone in turn, then on to the end.
    const path = (y: number) => [...coneXs.map((x, k) => ({ x, y: y + (k % 2 ? WEAVE : -WEAVE) })), { x: SLALOM_END, y }];
    const paths = LANE_Y.map(path);
    const stat: SlalomStat[] = SLALOMERS.map(() => ({ wp: 0, phase: 'lane', laneTime: null, turnAt: null, turnTime: null, minSpeed: Infinity, widest: 0, losses: 0, path: 0, lanePath: null }));

    const run: Run = {
      match: matches[0]!, extra: matches.slice(1), cones, t: 0, done: false,
      step() {
        const events: SimEvent[] = [];
        matches.forEach((m, i) => {
          const p = m.players[0]!;
          const st = stat[i]!;
          const y = LANE_Y[i]!;
          const route = paths[i]!;
          const had = m.owner === p.id;
          let input: Input = NO_INPUT;
          if (st.phase === 'done') input = NO_INPUT;
          else if (withBall && !had) {
            // Lost it: back to the ball first.
            input = toward(p, m.ball.x, m.ball.y, sprint, 0);
          } else if (st.phase === 'lane') {
            const wp = route[st.wp]!;
            if (Math.hypot(wp.x - p.x, wp.y - p.y) < 0.6 || p.x > wp.x + 0.2) st.wp++;
            if (st.wp >= route.length) {
              st.phase = 'turn';
              st.laneTime = run.t;
              st.lanePath = st.path;
              st.turnAt = run.t;
            }
            const next = route[Math.min(st.wp, route.length - 1)]!;
            input = toward(p, next.x, next.y, sprint, 0);
          }
          if (st.phase === 'turn' || st.phase === 'back') {
            // Back the way you came, along the lane.
            input = toward(p, SLALOM_END - 6, y, sprint, 0);
            // Turned: heading back at half running pace.
            if (st.phase === 'turn' && p.vx < -0.5 * p.stats.runSpeed) {
              st.phase = 'back';
              st.turnTime = run.t - st.turnAt!;
            }
            if (st.phase === 'back' && p.x < SLALOM_END - 5.5) st.phase = 'done';
          }
          const bx = p.x;
          const by = p.y;
          events.push(...step(m, { [p.id]: input }));
          st.path += Math.hypot(p.x - bx, p.y - by);
          if (withBall && had && m.owner !== p.id) st.losses++;
          if (st.phase === 'lane' && p.x > coneXs[0]! && p.x < coneXs[coneXs.length - 1]!) {
            st.minSpeed = Math.min(st.minSpeed, Math.hypot(p.vx, p.vy));
            st.widest = Math.max(st.widest, Math.abs(p.y - y));
          }
        });
        run.t += CONFIG.tick;
        if (stat.every(st => st.phase === 'done') || run.t > 40) run.done = true;
        return events;
      },
      readout() {
        const lanes = stat.map(st => st.laneTime);
        const both = lanes.every(v => v !== null);
        const lead = !both ? '-' : lanes[0] === lanes[1] ? 'level' : `${lanes[0]! < lanes[1]! ? SLALOMERS[0]!.label : SLALOMERS[1]!.label} by ${s(Math.abs(lanes[0]! - lanes[1]!))}`;
        const sections: Section[] = [{ title: 'Slalom', rows: [row('Cones', `${coneXs.length}, ${spacing} m apart`), row('Quicker', lead)] }];
        SLALOMERS.forEach((role, i) => {
          const st = stat[i]!;
          const p = matches[i]!.players[0]!;
          const ballAttrs: Attribute[] = withBall ? ['dribbling', 'pace'] : ['pace', 'dribbling'];
          sections.push({
            title: role.label, team: role.team, rows: [
              row('Speed', `${Math.hypot(p.vx, p.vy).toFixed(2)} m/s`, ...ballAttrs),
              row('Lane', st.laneTime === null ? '-' : `${s(st.laneTime)}, avg ${(st.lanePath! / Math.max(st.laneTime, 0.01)).toFixed(2)} m/s`, ...ballAttrs),
              row('Slowest cut', st.minSpeed === Infinity ? '-' : `${st.minSpeed.toFixed(2)} m/s`, 'dribbling'),
              row('Widest swing', `${m(st.widest)} off the line`, 'dribbling'),
              row('Turn back', st.turnTime === null ? '-' : s(st.turnTime), 'dribbling'),
              ...(withBall ? [row('Lost the ball', `${st.losses}×`, 'dribbling', 'pace')] : []),
            ],
          });
        });
        return sections;
      },
    };
    return run;
  },
};

// --- Shooting range ------------------------------------------------------
// Shooter A, then shooter B, from the same spot and aim, which you place by
// dragging on the pitch, at the right goal and its keeper if you like. Both
// play for gold, so the keeper treats them the same; B is only drawn in red.

const SHOOTERS: Role[] = [
  { id: 'a', label: 'Shooter A', team: 'gold' },
  { id: 'b', label: 'Shooter B', team: 'red' },
];

type ShotResult = 'goal' | 'saved' | 'smothered' | 'wide' | 'short';

interface Shot {
  result: ShotResult | null;
  speed: number | null;
  toLine: number | null;
  bend: number;
}

interface ShotPlan {
  spot: { x: number; y: number };
  target: { x: number; y: number };
  charge: number;
  curl: number;
  // How long the curl's held across the shot, seconds.
  curlHold: number;
  keeper: boolean;
}

const point = (v: string | undefined, fallback: { x: number; y: number }) => {
  const [x, y] = (v ?? '').split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : fallback;
};
export const SHOT_SPOT = { x: 3, y: 0 };
export const SHOT_TARGET = { x: width / 2, y: 0 };

const plan = (opts: Options): ShotPlan => ({
  spot: point(opts.spot, SHOT_SPOT),
  target: point(opts.target, SHOT_TARGET),
  charge: opts.charge === 'tap' ? 0 : opts.charge === 'half' ? 0.5 : 1,
  // +1 bends it towards the shooter's right as you see them on screen (the
  // sim's y runs down the screen), -1 their left.
  curl: opts.curl!.startsWith('left') ? -1 : opts.curl!.startsWith('right') ? 1 : 0,
  curlHold: opts.curl!.endsWith('-full') ? CONFIG.kick.aftertouch : 0.15,
  keeper: opts.keeper === 'on',
});

// One shot, stepped a tick at a time: settle, charge, release, aftertouch,
// then watch the ball until it's decided.
function shotRun(role: Role, attrs: Attributes, pl: ShotPlan, seed: number) {
  const match = createMatch([createPlayer(role.id, 'gold', attrs)], { practice: true, seed, keepers: pl.keeper });
  match.kickoffHeld = false;
  const p = match.players[0]!;
  const side = -homeSide('gold');
  Object.assign(p, { ...pl.spot, vx: 0, vy: 0 });
  const dl = Math.hypot(pl.target.x - p.x, pl.target.y - p.y) || 1;
  Object.assign(p, { fx: (pl.target.x - p.x) / dl, fy: (pl.target.y - p.y) / dl });
  Object.assign(match.ball, { x: p.x + p.fx * CONFIG.dribble.distance, y: p.y + p.fy * CONFIG.dribble.distance, vx: 0, vy: 0 });
  match.owner = p.id;
  // Only the right goal's keeper.
  const keeperId = KEEPER_IDS.red;
  const other = match.players.find(q => q.keeper && q.id !== keeperId);
  if (other) match.players.splice(match.players.indexOf(other), 1);

  const shot: Shot = { result: null, speed: null, toLine: null, bend: 0 };
  let t = 0;
  let phase: 'settle' | 'charge' | 'flight' = 'settle';
  let flightT = 0;
  const from = { x: 0, y: 0, dx: 0, dy: 0 };
  return {
    match, shot,
    get done() { return shot.result !== null; },
    step(): SimEvent[] {
      let input: Input = NO_INPUT;
      if (phase === 'settle' && t > 0.25) phase = 'charge';
      if (phase === 'charge') {
        input = { x: 0, y: 0, kick: !(p.action === 'charge' && p.charge >= pl.charge), sprint: false };
      } else if (phase === 'flight' && flightT < pl.curlHold && pl.curl) {
        // Held across the shot's path.
        input = { x: -from.dy * pl.curl, y: from.dx * pl.curl, kick: false, sprint: false };
      }
      const events = step(match, { [p.id]: input });
      t += CONFIG.tick;
      const { ball } = match;
      const keeper = match.players.find(q => q.id === keeperId);
      // Closed down and smothered before the shot, or a save after it.
      const blocked = keeper && Math.hypot(ball.x - keeper.x, ball.y - keeper.y) < keeper.r + ball.r + 0.05;
      if (keeper && (match.owner === keeper.id || match.lastTouch === keeper.id || (phase === 'flight' && blocked))) {
        shot.result = phase === 'flight' ? 'saved' : 'smothered';
      } else if (phase === 'charge' && events.some(e => e.type === 'kick' && e.player === p.id)) {
        phase = 'flight';
        shot.speed = Math.hypot(ball.vx, ball.vy);
        Object.assign(from, { x: ball.x, y: ball.y, dx: p.fx, dy: p.fy });
      } else if (phase === 'flight') {
        flightT += CONFIG.tick;
        shot.bend = Math.max(shot.bend, Math.abs((ball.x - from.x) * -from.dy + (ball.y - from.y) * from.dx));
        if (side * ball.x > width / 2 - ball.r) {
          shot.toLine = flightT;
          shot.result = Math.abs(ball.y) < CONFIG.pitch.goalWidth / 2 ? 'goal' : 'wide';
        } else if (Math.hypot(ball.vx, ball.vy) < 0.5 || flightT > 6) shot.result = 'short';
      }
      if (t > 10 && !shot.result) shot.result = 'short';
      return events;
    },
  };
}

const RESULT: Record<ShotResult, string> = { goal: 'Goal', saved: 'Saved', smothered: 'Smothered before the shot', wide: 'Wide', short: 'Off target' };

export const range: Scenario = {
  id: 'range',
  name: 'Shooting',
  roles: SHOOTERS,
  choices: [
    { key: 'charge', label: 'Charge', options: [{ value: 'tap', label: 'Tap' }, { value: 'half', label: 'Half' }, { value: 'full', label: 'Full' }] },
    {
      key: 'curl', label: 'Curl',
      options: [['none', 'None'], ['left', 'Left, light'], ['left-full', 'Left, full'], ['right', 'Right, light'], ['right-full', 'Right, full']].map(([value, label]) => ({ value: value!, label: label! })),
    },
    { key: 'keeper', label: 'Keeper', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
  ],
  hint: 'Drag the ring to move the shot, the end of the arrow to aim it.',
  defaults: { spot: `${SHOT_SPOT.x},${SHOT_SPOT.y}`, target: `${SHOT_TARGET.x},${SHOT_TARGET.y}`, charge: 'full', curl: 'none', keeper: 'on' },
  start(attrs, opts, seed) {
    const pl = plan(opts);
    const shots = SHOOTERS.map(role => shotRun(role, attrs[role.id]!, pl, seed));
    let k = 0;
    let pause = 0;
    const run: Run = {
      match: shots[0]!.match, t: 0, done: false,
      kits: Object.fromEntries(SHOOTERS.map(r => [r.id, r.team])),
      aim: { x: pl.spot.x, y: pl.spot.y, tx: pl.target.x, ty: pl.target.y },
      step() {
        const r = shots[k]!;
        const events = r.done ? [] : r.step();
        run.t += CONFIG.tick;
        if (r.done) {
          // A moment to see where it went, then the next shooter.
          pause += CONFIG.tick;
          if (pause > 0.8) {
            pause = 0;
            if (k + 1 < shots.length) run.match = shots[++k]!.match;
            else run.done = true;
          }
        }
        return events;
      },
      readout() {
        const goal = { x: width / 2, y: 0 };
        const dist = Math.hypot(goal.x - pl.spot.x, goal.y - pl.spot.y);
        const angle = (Math.atan2(pl.target.y - pl.spot.y, pl.target.x - pl.spot.x) * 180) / Math.PI;
        const sections: Section[] = [{
          title: 'Shot', rows: [
            row('From', `${m(dist)} from goal`),
            row('Aim', `${angle.toFixed(0)}° off straight`),
            row('Charge', opts.charge!),
            row('Curl', pl.curl ? `${pl.curl > 0 ? 'right' : 'left'}, held ${s(pl.curlHold)}` : 'none', 'power'),
          ],
        }];
        SHOOTERS.forEach((role, i) => {
          const { shot, match } = shots[i]!;
          const p = match.players[0]!;
          sections.push({
            title: role.label, team: role.team, rows: [
              row('Result', shot.result ? RESULT[shot.result] : i > k ? 'waiting' : '-', 'power'),
              row('Full power in', s(p.stats.chargeTime), 'power'),
              row('Shot speed', shot.speed === null ? '-' : `${shot.speed.toFixed(1)} m/s`, 'power'),
              row('To the line', shot.toLine === null ? '-' : s(shot.toLine), 'power'),
              row('Bend', m(shot.bend), 'power'),
            ],
          });
        });
        return sections;
      },
    };
    return run;
  },
  repeat(attrs, opts, runs) {
    const pl = plan(opts);
    return SHOOTERS.map(role => {
      const tally: Record<ShotResult, number> = { goal: 0, saved: 0, smothered: 0, wide: 0, short: 0 };
      for (let seed = 1; seed <= runs; seed++) {
        const r = shotRun(role, attrs[role.id]!, pl, seed);
        for (let i = 0; i < 2000 && !r.done; i++) r.step();
        tally[r.shot.result ?? 'short']++;
      }
      const pct = (n: number) => `${Math.round((n / runs) * 100)}%`;
      return {
        title: `${role.label}, ${runs} shots`, team: role.team,
        rows: (Object.keys(tally) as ShotResult[]).filter(k => tally[k]).map(k => row(RESULT[k], pct(tally[k]))),
      };
    });
  },
};

export const SCENARIOS: Scenario[] = [track, arena, slalom, range];

export const defaultAttrs = (scenario: Scenario): Record<string, Attributes> =>
  Object.fromEntries(scenario.roles.map(r => [r.id, evenAttributes()]));
