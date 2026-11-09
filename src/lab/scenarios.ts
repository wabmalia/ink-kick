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
  // Greyed out unless this holds for the options picked.
  enabled?: (opts: Options) => boolean;
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
  cones?: { x: number; y: number; label?: string }[];
  // Kits to draw players in, where it isn't the team they play for.
  kits?: Record<string, Team>;
  // The defensive stance's zone, drawn round the player on the ball.
  zone?: { x: number; y: number; fx: number; fy: number; ax: number; ay: number; afx: number; afy: number; active: boolean };
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


// --- Stance --------------------------------------------------------------
// An attacker standing on the ball, and a defender squaring up to them: in,
// a shuffle across and back between the cones, a step back, then in to
// tackle. With the stance off, the same keys turn the defender each way
// they go.

const STANCE_ROLES: Role[] = [
  { id: 'attacker', label: 'Attacker', team: 'gold' },
  { id: 'defender', label: 'Defender', team: 'red' },
];

type StanceOutcome = 'won' | 'ridden' | 'penalized' | 'missed';

const STANCE_OUTCOME: Record<StanceOutcome, string> = {
  won: 'Tackle won',
  ridden: 'Ridden',
  penalized: 'Won, penalized',
  missed: 'Missed',
};

// The defender's drills: legs to walk (or sprint), metres in front of the
// attacker and to their left, from a start spot facing a way.
interface Leg { label: string; d: number; l: number; sprint?: boolean }
interface Drill {
  label: string;
  from: { d: number; l: number; fd: number; fl: number };
  legs: Leg[];
  // Whether it ends in a tackle (the Then option).
  tackles: boolean;
  cones?: { d: number; l: number; label: string }[];
}
const SQUARE = 3;
const SHUFFLE = 1.5;
const DRILLS: Record<string, Drill> = {
  shuffle: {
    label: 'Shuffle',
    from: { d: 8, l: 0, fd: -1, fl: 0 },
    legs: [
      { label: 'In to 3m', d: SQUARE, l: 0 },
      { label: 'Across 1.5m', d: SQUARE, l: SHUFFLE },
      { label: 'Across 3m', d: SQUARE, l: -SHUFFLE },
      { label: 'Across 1.5m', d: SQUARE, l: 0 },
      { label: 'Back 1.5m', d: SQUARE + 1.5, l: 0 },
    ],
    tackles: true,
    cones: [
      { d: SQUARE, l: SHUFFLE + 0.6, label: '1' },
      { d: SQUARE, l: -SHUFFLE - 0.6, label: '2' },
      { d: SQUARE + 2.1, l: 0, label: '3' },
    ],
  },
  out: {
    label: 'Out sideways',
    from: { d: 8, l: 0, fd: -1, fl: 0 },
    legs: [
      { label: 'In to 3m', d: SQUARE, l: 0 },
      { label: 'Across 6m', d: SQUARE, l: 6 },
      // Back in towards them, so they're ahead again: squares up at 4m.
      { label: 'Back in', d: 2, l: 1.5 },
      { label: 'Across 1.5m', d: SQUARE, l: 0 },
    ],
    tackles: false,
  },
  sprint: {
    label: 'Sprint off',
    from: { d: 8, l: 0, fd: -1, fl: 0 },
    legs: [
      { label: 'In to 3m', d: SQUARE, l: 0 },
      { label: 'Across 1.5m', d: SQUARE, l: SHUFFLE },
      { label: 'Sprint back', d: 11, l: SHUFFLE, sprint: true },
    ],
    tackles: false,
  },
  behind: {
    label: 'From behind',
    // Behind them and looking at them, in range: chasing, so no stance
    // until round the side and in front.
    from: { d: -3, l: 0.3, fd: 1, fl: 0 },
    legs: [
      { label: 'Round the side', d: -0.5, l: 4 },
      { label: 'Into the front', d: 2.5, l: 3 },
      { label: 'Turn in', d: 2.2, l: 0.8 },
    ],
    tackles: true,
  },
  turn: {
    label: 'Turn in',
    // From beside them, running round into the cone still looking past
    // them, then turning in.
    from: { d: 0.5, l: 6, fd: 1, fl: 0 },
    legs: [
      { label: 'Round the side', d: SQUARE, l: SHUFFLE },
      { label: 'Turn in', d: SQUARE - 0.8, l: 0 },
    ],
    tackles: true,
  },
};

const deg = (rad: number) => (rad * 180) / Math.PI;

export const stance: Scenario = {
  id: 'stance',
  name: 'Stance',
  roles: STANCE_ROLES,
  choices: [
    { key: 'drill', label: 'Drill', options: Object.entries(DRILLS).map(([value, d]) => ({ value, label: d.label })) },
    { key: 'guard', label: 'Stance', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
    {
      key: 'kind', label: 'Then', options: [['poke', 'Poke'], ['slide', 'Slide'], ['none', 'No tackle']].map(([value, label]) => ({ value: value!, label: label! })),
      enabled: o => DRILLS[o.drill!]!.tackles,
    },
  ],
  hint: 'Squares up with the attacker in the blue wedge (4m, 45°) and standing in their gold cone (120°); lets go past the faint lines or on a sprint.',
  defaults: { drill: 'shuffle', guard: 'on', kind: 'poke' },
  start(attrs, opts, seed) {
    const match = labMatch(STANCE_ROLES.map(role => ({ role, attrs: attrs[role.id]! })), seed);
    const [att, def] = match.players as [Match['players'][number], Match['players'][number]];
    const drill = DRILLS[opts.drill!] ?? DRILLS.shuffle!;
    const ax = -width / 2 + 9;
    Object.assign(att, { x: ax, y: 0, fx: 1, fy: 0 });
    Object.assign(match.ball, { x: ax + CONFIG.dribble.distance, y: 0 });
    match.owner = att.id;
    // Where the attacker's facing (+x) puts each spot.
    const spot = (d: number, l: number) => ({ x: ax + d, y: l });
    Object.assign(def, { ...spot(drill.from.d, drill.from.l), fx: drill.from.fd, fy: drill.from.fl });
    const on = opts.guard === 'on';
    // Switched off, for the comparison.
    match.noGuard = !on;
    const kind = drill.tackles ? opts.kind : 'none';
    const pressAt = kind === 'slide' ? 2.4 : 1.1;

    let leg = 0;
    let legFrom = 0;
    const legs: { time: number; dist: number }[] = [];
    let walked = 0;
    let pressed = false;
    let sprintHeld = false;
    let outcome: StanceOutcome | null = null;
    let at: number | null = null;
    let tackleKind: string | null = null;
    let squared: { dist: number; facing: number; at: number } | null = null;
    let letGo: { why: string; dist: number; facing: number } | null = null;
    let again: { dist: number; facing: number; at: number } | null = null;
    let inStance = 0;
    let worst = 0;
    let facingAtPress: number | null = null;
    // Degrees the defender looks away from the attacker; and round from the
    // way the attacker faces, where the defender stands.
    const roundAngle = () => Math.abs(deg(Math.atan2(att.fx * (def.y - att.y) - att.fy * (def.x - att.x), att.fx * (def.x - att.x) + att.fy * (def.y - att.y))));
    const faceAngle = () => {
      const dx = att.x - def.x;
      const dy = att.y - def.y;
      return deg(Math.acos(Math.max(-1, Math.min(1, (def.fx * dx + def.fy * dy) / (Math.hypot(dx, dy) || 1)))));
    };
    const gap = () => Math.hypot(att.x - def.x, att.y - def.y);

    const run: Run = {
      match, t: 0, done: false,
      cones: drill.cones?.map(c => ({ ...spot(c.d, c.l), label: c.label })),
      zone: { x: def.x, y: def.y, fx: def.fx, fy: def.fy, ax: att.x, ay: att.y, afx: att.fx, afy: att.fy, active: false },
      step() {
        const ball = match.ball;
        const inputs: Record<string, Input> = {};
        // The attacker stands on it; once it's gone, goes for it.
        inputs.attacker = match.owner === att.id ? NO_INPUT : toward(att, ball.x, ball.y, true, 0);
        if (leg < drill.legs.length) {
          const to = drill.legs[leg]!;
          const p = spot(to.d, to.l);
          if (Math.hypot(p.x - def.x, p.y - def.y) < 0.15) {
            legs.push({ time: run.t - legFrom, dist: walked });
            leg++;
            legFrom = run.t;
            walked = 0;
          }
        }
        if (leg < drill.legs.length) {
          const to = drill.legs[leg]!;
          const p = spot(to.d, to.l);
          inputs.defender = toward(def, p.x, p.y, !!to.sprint, 0.1);
        } else if (!pressed && kind !== 'none') {
          const ballDist = Math.hypot(ball.x - def.x, ball.y - def.y);
          const go = toward(def, ball.x, ball.y, false, 0);
          if (ballDist < pressAt) {
            pressed = true;
            facingAtPress = faceAngle();
            inputs.defender = { ...go, kick: true };
          } else {
            inputs.defender = go;
          }
        } else {
          inputs.defender = at === null ? NO_INPUT : toward(def, ball.x, ball.y, true, 0);
        }
        sprintHeld = inputs.defender.sprint;

        const was = def.guarding;
        const owner = match.owner;
        const bx = def.x;
        const by = def.y;
        const events = step(match, inputs);
        run.t += CONFIG.tick;
        walked += Math.hypot(def.x - bx, def.y - by);
        if (def.guarding) {
          inStance += CONFIG.tick;
          if (!squared) squared = { dist: gap(), facing: faceAngle(), at: run.t };
          else if (letGo && !again) again = { dist: gap(), facing: faceAngle(), at: run.t };
          worst = Math.max(worst, faceAngle());
        }
        if (was && !def.guarding && !letGo) {
          const g = CONFIG.guard;
          const why = pressed ? 'tackled'
            : match.owner !== owner ? 'the ball moved on'
            : sprintHeld ? 'sprinting'
              : def.action !== 'none' && def.action !== 'poke' ? `a ${def.action}`
                : gap() > g.leave ? 'out of range'
                  : faceAngle() > g.coneLeave ? 'out of the cone'
                    : roundAngle() > g.frontLeave ? 'not in front' : 'let go';
          letGo = { why, dist: gap(), facing: faceAngle() };
        }
        Object.assign(run.zone!, { x: def.x, y: def.y, fx: def.fx, fy: def.fy, ax: att.x, ay: att.y, afx: att.fx, afy: att.fy, active: !!def.guarding });
        for (const e of events) {
          if (e.type === 'poke' || e.type === 'slide') tackleKind = e.type;
          if (outcome && outcome !== 'won') continue;
          if (e.type === 'penalized') outcome = 'penalized';
          else if (e.type === 'steal' && !outcome) outcome = 'won';
          else if (e.type === 'shrug') outcome = 'ridden';
          if (outcome && at === null) at = run.t;
        }
        if (pressed && at === null && tackleKind && def.action === 'none') {
          outcome = 'missed';
          at = run.t;
        }
        const down = match.players.some(p => p.action === 'stumble' || p.action === 'recover' || p.action === 'slide');
        const finished = leg >= drill.legs.length && kind === 'none' && run.t - legFrom > 1;
        if ((at !== null && run.t - at > 1.5 && !down) || finished || run.t > 15) run.done = true;
        return events;
      },
      readout() {
        const sections: Section[] = [
          {
            title: 'Stance', rows: [
              row('Squared up', squared ? `at ${m(squared.dist)}, ${Math.round(squared.facing)}° off, ${s(squared.at)}` : on ? 'not yet' : 'off'),
              row('Let go', letGo ? `${letGo.why}, ${m(letGo.dist)}, ${Math.round(letGo.facing)}° off` : def.guarding ? 'still in it' : '-'),
              row('Squared again', again ? `at ${m(again.dist)}, ${Math.round(again.facing)}° off, ${s(again.at)}` : '-'),
              row('Facing now', `${Math.round(faceAngle())}° off${squared ? `, at most ${Math.round(worst)}° in it` : ''}`),
            ],
          },
          {
            title: 'Moves', rows: drill.legs.map((l, i) => {
              const done = legs[i];
              return row(l.label, done ? `${s(done.time)}, ${(done.dist / done.time).toFixed(2)} m/s` : '-', 'pace');
            }),
          },
        ];
        if (drill.tackles) {
          sections.push({
            title: 'Challenge', rows: [
              row('Tackle', tackleKind ?? (kind === 'none' ? 'none' : 'not yet')),
              row('Facing at it', facingAtPress === null ? '-' : `${Math.round(facingAtPress)}° off`),
              row('Result', outcome ? STANCE_OUTCOME[outcome] : '-', 'tackling', 'strength', 'dribbling'),
              row('Win odds', `${Math.round(holdOdds(def, att) * 100)}% if it reaches`, 'tackling', 'strength', 'dribbling'),
            ],
          });
        }
        return sections;
      },
    };
    return run;
  },
  repeat(attrs, opts, runs) {
    if (!DRILLS[opts.drill!]?.tackles || opts.kind === 'none') return [{ title: `${runs} runs`, rows: [row('No tackle', 'nothing left to chance')] }];
    const tally: Partial<Record<StanceOutcome, number>> = {};
    for (let seed = 1; seed <= runs; seed++) {
      const r = stance.start(attrs, opts, seed);
      let outcome: StanceOutcome | null = null;
      while (!r.done) {
        for (const e of r.step()) {
          if (e.type === 'penalized') outcome = 'penalized';
          else if (e.type === 'shrug') outcome ??= 'ridden';
          else if (e.type === 'steal') outcome ??= 'won';
        }
      }
      outcome ??= 'missed';
      tally[outcome] = (tally[outcome] ?? 0) + 1;
    }
    const pct = (n: number) => `${Math.round((n / runs) * 100)}%`;
    return [{
      title: `${runs} runs`,
      rows: (Object.keys(STANCE_OUTCOME) as StanceOutcome[]).filter(k => tally[k]).map(k => row(STANCE_OUTCOME[k], pct(tally[k]!))),
    }];
  },
};

// --- Slalom --------------------------------------------------------------
// Two dribblers side by side, each with their own ball (their own match, so
// they can't get in each other's way), round a course: weaving through a
// lane of cones, or a Z of two hard corners with straights between. Then on
// to the end and a turn back on yourself.

const SLALOMERS: Role[] = [
  { id: 'a', label: 'Dribbler A', team: 'gold' },
  { id: 'b', label: 'Dribbler B', team: 'red' },
];
// The courses mirror each other across the pitch's middle line, each one
// centred on a side line of the goal area (the keeper's small box).
const MIRROR_Y = 0;
const LANE_OFF = CONFIG.keeper.boxHalf;
const SLALOM_START = -12;
const SLALOM_END = 11;
// How far either side of each cone the path goes, and how close to that
// point counts as through the gate.
const WEAVE = 1.2;
const GATE = 0.5;
// The Z: a straight, a diagonal back and a straight on, Z_HALF either side
// of its middle, on the goal area's side line like the cone lanes (so the
// two finishing straights are 4.2 m apart).
const Z_HALF = 1.5;
const Z_OFF = LANE_OFF;
// Where a Z starts and finishes: short straights either side of its corners
// (round x = 2), so nobody's tired by the end.
const Z_START = -3;
const Z_END = 7;

type Point = { x: number; y: number };

interface Course {
  start: Point;
  // The points to reach in turn; the last is the end, turned back from.
  route: Point[];
  cones: Point[];
  // Whether a point is where the turns are, for the slowest-cut reading.
  inTurns(p: Point): boolean;
  // Which of the route's points are corners, for the overrun reading.
  corners?: number[];
  // Cones drawn to show the course's shape that nobody can run into.
  markers?: Point[];
}

// The same course reflected in the mirror line: B's runs as A's does, the
// other way up.
function mirrored(c: Course): Course {
  const flip = (p: Point) => ({ x: p.x, y: 2 * MIRROR_Y - p.y });
  return {
    start: flip(c.start),
    route: c.route.map(flip),
    cones: c.cones.map(flip),
    inTurns: p => c.inTurns(flip(p)),
    corners: c.corners,
    markers: c.markers?.map(flip),
  };
}

function coneCourse(y: number, spacing: number): Course {
  const xs: number[] = [];
  for (let x = SLALOM_START + 4; x <= SLALOM_END - 3; x += spacing) xs.push(x);
  return {
    start: { x: SLALOM_START, y },
    // Either side of each cone in turn, then on to the end.
    route: [...xs.map((x, k) => ({ x, y: y + (k % 2 ? WEAVE : -WEAVE) })), { x: SLALOM_END, y }],
    cones: xs.map(x => ({ x, y })),
    inTurns: p => p.x > xs[0]! && p.x < xs[xs.length - 1]!,
  };
}

// A straight run between two pins, for speed with and without the ball.
const STRAIGHT_START = -10;
const STRAIGHT_END = 10;
function straightCourse(y: number): Course {
  return {
    start: { x: STRAIGHT_START, y },
    route: [{ x: STRAIGHT_END, y }],
    cones: [],
    inTurns: () => false,
    markers: [{ x: STRAIGHT_START - 0.8, y }, { x: STRAIGHT_END + 0.8, y }],
  };
}

function zCourse(band: number, degrees: number): Course {
  const top = band - Z_HALF;
  const bottom = band + Z_HALF;
  // The diagonal leans back by the corner's angle past square.
  const back = (2 * Z_HALF) / Math.tan(((180 - degrees) * Math.PI) / 180);
  const a = { x: 2 + back / 2, y: top };
  const b = { x: 2 - back / 2, y: bottom };
  // A cone just outside each corner, to go round, and one in the middle of
  // each straight, gone round on the inside, so neither is a clear run.
  const out = 0.7;
  const mid1 = { x: (Z_START + a.x) / 2, y: top };
  const mid2 = { x: (b.x + Z_END) / 2, y: bottom };
  const round = 1.5;
  return {
    start: { x: Z_START, y: top },
    route: [{ x: mid1.x, y: top + round }, a, b, { x: mid2.x, y: bottom - round }, { x: Z_END, y: bottom }],
    cones: [mid1, { x: a.x + out, y: a.y - out }, { x: b.x - out, y: b.y + out }, mid2],
    corners: [1, 2],
    // The Z's open ends, where it starts and where it finishes.
    markers: [{ x: Z_START - 0.8, y: top }, { x: Z_END + 0.8, y: bottom }],
    // Within 3 m of either corner.
    inTurns: p => Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y)) < 3,
  };
}

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
  // Time spent where the turns are.
  turnsTime: number;
}

export const slalom: Scenario = {
  id: 'slalom',
  name: 'Slalom',
  roles: SLALOMERS,
  choices: [
    {
      key: 'course', label: 'Course',
      options: [{ value: 'straight', label: 'Straight' }, { value: 'cones', label: 'Cone weave' }, { value: 'z', label: 'Z, 110° corners' }, { value: 'z-sharp', label: 'Z, 145° corners' }],
    },
    {
      key: 'spacing', label: 'Cone gaps', enabled: o => o.course === 'cones',
      options: [{ value: '2.5', label: 'Tight (2.5 m)' }, { value: '3.5', label: 'Medium (3.5 m)' }, { value: '5', label: 'Wide (5 m)' }],
    },
    { key: 'pace', label: 'Pace', options: [{ value: 'run', label: 'Run' }, { value: 'sprint', label: 'Sprint (hold)' }] },
    { key: 'ball', label: 'Ball', options: [{ value: 'with', label: 'With the ball' }, { value: 'without', label: 'Without' }] },
  ],
  defaults: { course: 'cones', spacing: '3.5', pace: 'run', ball: 'with' },
  start(attrs, opts) {
    const spacing = Number(opts.spacing);
    const sprint = opts.pace === 'sprint';
    const withBall = opts.ball === 'with';
    const z = opts.course?.startsWith('z');
    const straight = opts.course === 'straight';
    const first = z ? zCourse(MIRROR_Y - Z_OFF, opts.course === 'z-sharp' ? 145 : 110)
      : straight ? straightCourse(MIRROR_Y - LANE_OFF) : coneCourse(MIRROR_Y - LANE_OFF, spacing);
    const courses = [first, mirrored(first)];
    // Numbered in the order they're passed; the markers aren't.
    const cones = courses.flatMap(c => [...c.cones.map((p, k) => ({ ...p, label: String(k + 1) })), ...(c.markers ?? [])]);
    const matches = SLALOMERS.map((role, i) => {
      const m = labMatch([{ role, attrs: attrs[role.id]! }], 1);
      const course = courses[i]!;
      for (const c of course.cones) m.posts.push({ ...c, vx: 0, vy: 0, r: CONE_RADIUS, invMass: 0, damping: 1, bounce: 0.3 });
      const p = m.players[0]!;
      const { x, y } = course.start;
      Object.assign(p, { x, y, fx: 1, fy: 0 });
      if (withBall) {
        Object.assign(m.ball, { x: x + CONFIG.dribble.distance, y });
        m.owner = p.id;
      } else {
        Object.assign(m.ball, { x: -width / 2 + 0.5, y: (i ? 1 : -1) * (height / 2 - 0.5) });
      }
      return m;
    });
    const paths = courses.map(c => c.route);
    const stat: SlalomStat[] = SLALOMERS.map(() => ({ wp: 0, phase: 'lane', laneTime: null, turnAt: null, turnTime: null, minSpeed: Infinity, widest: 0, losses: 0, path: 0, lanePath: null, turnsTime: 0 }));

    const run: Run = {
      match: matches[0]!, extra: matches.slice(1), cones, t: 0, done: false,
      step() {
        const events: SimEvent[] = [];
        matches.forEach((m, i) => {
          const p = m.players[0]!;
          const st = stat[i]!;
          const route = paths[i]!;
          const end = route[route.length - 1]!;
          const had = m.owner === p.id;
          let input: Input = NO_INPUT;
          if (st.phase === 'done') input = NO_INPUT;
          else if (withBall && !had) {
            // Lost it: back to the ball first.
            input = toward(p, m.ball.x, m.ball.y, sprint, 0);
          } else if (st.phase === 'lane') {
            const wp = route[st.wp]!;
            // Each gate has to be reached, so a wide line costs time.
            if (Math.hypot(wp.x - p.x, wp.y - p.y) < GATE) st.wp++;
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
            input = toward(p, end.x - 6, end.y, sprint, 0);
            // Turned: heading back at half running pace.
            if (st.phase === 'turn' && p.vx < -0.5 * p.stats.runSpeed) {
              st.phase = 'back';
              st.turnTime = run.t - st.turnAt!;
            }
            if (st.phase === 'back' && p.x < end.x - 5.5) st.phase = 'done';
          }
          const bx = p.x;
          const by = p.y;
          events.push(...step(m, { [p.id]: input }));
          st.path += Math.hypot(p.x - bx, p.y - by);
          if (withBall && had && m.owner !== p.id) st.losses++;
          if (st.phase === 'lane' && courses[i]!.inTurns(p)) {
            st.turnsTime += CONFIG.tick;
            st.minSpeed = Math.min(st.minSpeed, Math.hypot(p.vx, p.vy));
            if (!z) {
              // Off the line through the cones.
              st.widest = Math.max(st.widest, Math.abs(p.y - courses[i]!.start.y));
            } else if (courses[i]!.corners?.includes(st.wp - 1)) {
              // Past the last corner reached, the way you came into it: how
              // far the corner was overrun.
              const g = route[st.wp - 1]!;
              const prev = st.wp >= 2 ? route[st.wp - 2]! : courses[i]!.start;
              const len = Math.hypot(g.x - prev.x, g.y - prev.y) || 1;
              const past = ((p.x - g.x) * (g.x - prev.x) + (p.y - g.y) * (g.y - prev.y)) / len;
              st.widest = Math.max(st.widest, past);
            }
          }
        });
        run.t += CONFIG.tick;
        if (stat.every(st => st.phase === 'done') || run.t > 40) run.done = true;
        return events;
      },
      readout() {
        const lanes = stat.map(st => st.laneTime);
        const both = lanes.every(v => v !== null);
        // Short, so the tables stay side by side: "B by 0.13s".
        const who = (aFirst: boolean) => (aFirst ? 'A' : 'B');
        const lead = !both ? '-' : lanes[0] === lanes[1] ? 'level' : `${who(lanes[0]! < lanes[1]!)} by ${s(Math.abs(lanes[0]! - lanes[1]!))}`;
        const turns = stat.map(st => st.turnsTime);
        const turnsLead = !both ? '-' : Math.abs(turns[0]! - turns[1]!) < 0.005 ? 'level' : `${who(turns[0]! < turns[1]!)} by ${s(Math.abs(turns[0]! - turns[1]!))}`;
        const what = z ? `Z, ${opts.course === 'z-sharp' ? 145 : 110}°` : straight ? `straight, ${STRAIGHT_END - STRAIGHT_START} m` : `${courses[0]!.cones.length} cones, ${spacing} m`;
        const turnsLabel = z ? 'Round the corners' : 'Through the cones';
        const sections: Section[] = [{ title: 'Slalom', rows: [row('Course', what), row('Quicker', lead), ...(straight ? [] : [row(turnsLabel, turnsLead)])] }];
        SLALOMERS.forEach((role, i) => {
          const st = stat[i]!;
          const p = matches[i]!.players[0]!;
          const ballAttrs: Attribute[] = withBall ? ['dribbling', 'pace'] : ['pace', 'dribbling'];
          sections.push({
            title: role.label, team: role.team, rows: [
              row('Speed', `${Math.hypot(p.vx, p.vy).toFixed(2)} m/s`, ...ballAttrs),
              row('Lane', st.laneTime === null ? '-' : `${s(st.laneTime)}, avg ${(st.lanePath! / Math.max(st.laneTime, 0.01)).toFixed(2)} m/s`, ...ballAttrs),
              ...(straight ? [] : [
                row(turnsLabel, st.laneTime === null ? '-' : s(st.turnsTime), 'dribbling'),
                row('Slowest cut', st.minSpeed === Infinity ? '-' : `${st.minSpeed.toFixed(2)} m/s`, 'dribbling'),
                z ? row('Overran a corner', `by ${m(st.widest)}`, 'dribbling', 'pace') : row('Widest swing', `${m(st.widest)} off the line`, 'dribbling'),
              ]),
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

// --- Pass ----------------------------------------------------------------
// Two passers side by side, each standing, running or sprinting up with the
// ball, then tapping it on and keeping going: how fast the pass goes off and
// how far it gets away from them.

const PASSERS: Role[] = [
  { id: 'a', label: 'Passer A', team: 'gold' },
  { id: 'b', label: 'Passer B', team: 'red' },
];
const PASS_START = -13;
const PASS_LANE = 5;
// Seconds of run-up before the kick, and of following it after.
const RUN_UP = 1.2;
const FOLLOW = 1.5;

interface PassStat {
  phase: 'up' | 'charge' | 'follow' | 'done';
  t: number;
  ran: number | null;
  pass: number | null;
  ahead: number | null;
  caught: number | null;
}

export const pass: Scenario = {
  id: 'pass',
  name: 'Pass',
  roles: PASSERS,
  choices: [
    { key: 'move', label: 'Run up', options: [{ value: 'stand', label: 'Standing' }, { value: 'run', label: 'Running' }, { value: 'sprint', label: 'Sprinting' }] },
    { key: 'charge', label: 'Kick', options: [{ value: 'tap', label: 'Tap' }, { value: 'half', label: 'Half power' }] },
  ],
  hint: 'They keep going after the kick: does the pass get away from them?',
  defaults: { move: 'sprint', charge: 'tap' },
  start(attrs, opts) {
    const moving = opts.move !== 'stand';
    const sprint = opts.move === 'sprint';
    const matches = PASSERS.map((role, i) => {
      const m = labMatch([{ role, attrs: attrs[role.id]! }], 1);
      const p = m.players[0]!;
      const y = i ? PASS_LANE : -PASS_LANE;
      Object.assign(p, { x: PASS_START, y, fx: 1, fy: 0 });
      Object.assign(m.ball, { x: PASS_START + CONFIG.dribble.distance, y });
      m.owner = p.id;
      return m;
    });
    const stat: PassStat[] = PASSERS.map(() => ({ phase: 'up', t: 0, ran: null, pass: null, ahead: null, caught: null }));
    const cones = [-1, 1].map(k => ({ x: PASS_START - 0.8, y: k * PASS_LANE }));

    const run: Run = {
      match: matches[0]!, extra: matches.slice(1), cones, t: 0, done: false,
      step() {
        const events: SimEvent[] = [];
        matches.forEach((m, i) => {
          const p = m.players[0]!;
          const st = stat[i]!;
          const go = moving ? { x: 1, y: 0, sprint } : { x: 0, y: 0, sprint: false };
          let input: Input = { ...go, kick: false };
          if (st.phase === 'up' && run.t >= RUN_UP) {
            st.phase = 'charge';
            st.ran = Math.hypot(p.vx, p.vy);
          }
          if (st.phase === 'charge') {
            // A tap is a few frames; half power is held to half the charge.
            const hold = opts.charge === 'half' ? 0.5 : 0.05;
            input = { ...go, kick: !(p.action === 'charge' && p.charge >= hold) };
          }
          const out = step(m, { [p.id]: input });
          events.push(...out);
          if (st.phase === 'charge' && out.some(e => e.type === 'kick' && e.player === p.id)) {
            st.phase = 'follow';
            st.pass = Math.hypot(m.ball.vx, m.ball.vy);
          } else if (st.phase === 'follow') {
            st.t += CONFIG.tick;
            if (st.caught === null && m.owner === p.id) st.caught = st.t;
            if (st.ahead === null && st.caught === null && st.t >= 1) st.ahead = m.ball.x - p.x;
            if (st.t >= FOLLOW) st.phase = 'done';
          }
        });
        run.t += CONFIG.tick;
        if (stat.every(st => st.phase === 'done') || run.t > 10) run.done = true;
        return events;
      },
      readout() {
        const sections: Section[] = [{
          title: 'Pass', rows: [
            row('Run up', `${opts.move}, ${moving ? s(RUN_UP) : 'still'}`),
            row('Kick', opts.charge === 'half' ? 'half power' : 'tap'),
          ],
        }];
        PASSERS.forEach((role, i) => {
          const st = stat[i]!;
          sections.push({
            title: role.label, team: role.team, rows: [
              row('Speed at the kick', st.ran === null ? '-' : `${st.ran.toFixed(2)} m/s`, 'pace'),
              row('Pass speed', st.pass === null ? '-' : `${st.pass.toFixed(1)} m/s`, 'pace', 'power'),
              row('Ahead after 1 s', st.ahead !== null ? m(st.ahead) : st.caught !== null && st.caught < 1 ? 'caught by then' : '-', 'pace'),
              row('Caught it up', st.caught === null ? (st.phase === 'done' ? 'no' : '-') : `after ${s(st.caught)}`, 'pace'),
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
  // The shooter's speed as they started the kick.
  ran: number | null;
}

interface ShotPlan {
  spot: { x: number; y: number };
  target: { x: number; y: number };
  charge: number;
  curl: number;
  // How long the curl's held across the shot, seconds.
  curlHold: number;
  keeper: boolean;
  // Coming onto the spot from RUN_IN metres back, running or sprinting, or
  // standing on it.
  runUp: 'stand' | 'run' | 'sprint';
}

const RUN_IN = 6;
// Seconds a shot plays on once it's decided.
const SHOT_AFTER = Math.min(1.6, CONFIG.restartDelay - 0.1);

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
  runUp: opts.runUp === 'run' || opts.runUp === 'sprint' ? opts.runUp : 'stand',
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
  // A run-up starts back along the line of the shot.
  const moving = pl.runUp !== 'stand';
  const sprint = pl.runUp === 'sprint';
  if (moving) Object.assign(p, { x: p.x - p.fx * RUN_IN, y: p.y - p.fy * RUN_IN });
  const aim = { x: p.fx, y: p.fy };
  Object.assign(match.ball, { x: p.x + p.fx * CONFIG.dribble.distance, y: p.y + p.fy * CONFIG.dribble.distance, vx: 0, vy: 0 });
  match.owner = p.id;
  // Only the right goal's keeper.
  const keeperId = KEEPER_IDS.red;
  const other = match.players.find(q => q.keeper && q.id !== keeperId);
  if (other) match.players.splice(match.players.indexOf(other), 1);

  const shot: Shot = { result: null, speed: null, toLine: null, bend: 0, ran: null };
  let t = 0;
  let phase: 'settle' | 'run' | 'charge' | 'flight' = 'settle';
  let flightT = 0;
  const from = { x: 0, y: 0, dx: 0, dy: 0 };
  return {
    match, shot,
    get done() { return shot.result !== null; },
    step(): SimEvent[] {
      // Decided: play on untouched, to see the save or the ball in the net.
      if (shot.result) return step(match, { [p.id]: NO_INPUT });
      let input: Input = NO_INPUT;
      if (phase === 'settle' && t > 0.25) phase = moving ? 'run' : 'charge';
      // Onto the spot: the kick starts there.
      if (phase === 'run' && (p.x - pl.spot.x) * aim.x + (p.y - pl.spot.y) * aim.y >= 0) phase = 'charge';
      if (phase === 'charge' && shot.ran === null) shot.ran = Math.hypot(p.vx, p.vy);
      const go = moving ? { x: aim.x, y: aim.y, sprint } : { x: 0, y: 0, sprint: false };
      if (phase === 'run') {
        input = { ...go, kick: false };
      } else if (phase === 'charge') {
        input = { ...go, kick: !(p.action === 'charge' && p.charge >= pl.charge) };
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
    { key: 'runUp', label: 'Run up', options: [{ value: 'stand', label: 'Standing' }, { value: 'run', label: 'Running' }, { value: 'sprint', label: 'Sprinting' }] },
    { key: 'keeper', label: 'Keeper', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }] },
  ],
  hint: 'Drag the ring to move the shot, the end of the arrow to aim it.',
  defaults: { spot: `${SHOT_SPOT.x},${SHOT_SPOT.y}`, target: `${SHOT_TARGET.x},${SHOT_TARGET.y}`, charge: 'full', curl: 'none', runUp: 'stand', keeper: 'on' },
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
        const decided = r.done;
        const events = r.step();
        run.t += CONFIG.tick;
        if (decided) {
          // Played on for a while to see where it went (short of the
          // restart after a goal), then the next shooter.
          pause += CONFIG.tick;
          if (pause > SHOT_AFTER) {
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
            row('Run up', pl.runUp === 'stand' ? 'standing' : `${pl.runUp === 'run' ? 'running' : 'sprinting'}, ${RUN_IN} m`),
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
              row('Speed at the kick', shot.ran === null ? '-' : `${shot.ran.toFixed(2)} m/s`, 'pace'),
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

export const SCENARIOS: Scenario[] = [track, arena, stance, slalom, pass, range];

export const defaultAttrs = (scenario: Scenario): Record<string, Attributes> =>
  Object.fromEntries(scenario.roles.map(r => [r.id, evenAttributes()]));
