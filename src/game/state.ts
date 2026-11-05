import { CONFIG } from '../config';
import type { Action, Match, SimEvent, Team } from '../engine/sim';
import { ACTIONS, type PlayerState, type Snapshot } from '../net/protocol';

// What the scene draws, whoever runs the match: positions already
// interpolated for this frame.

export interface PlayerView {
  id: string;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  action: Action;
  actionT: number;
  charge: number;
  stamina: number;
  // Fraction of the tired spell left, 0 when not tired.
  tired: number;
}

export interface ViewState {
  players: PlayerView[];
  ballX: number;
  ballY: number;
  score: Record<Team, number>;
  // Spare balls lying about the training ground.
  props?: { x: number; y: number }[];
  // On the training ground: the ring around you showing your poke range.
  reach?: { x: number; y: number; r: number };
  // Seconds of play, for the clock on the scoreboard.
  clock?: number;
  // On the boards under the billboard during a match: how it's won, and how
  // it stands (the target, or the time left).
  info?: [string, string];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function toSnapshot(match: Match, tick: number): Snapshot {
  return {
    tick,
    ball: [round(match.ball.x), round(match.ball.y)],
    owner: match.owner,
    score: [match.score.gold, match.score.red],
    clock: Math.round(match.clock * 10) / 10,
    players: match.players.map(p => [
      p.id, p.team === 'gold' ? 0 : 1,
      round(p.x), round(p.y), round(p.vx), round(p.vy), round(p.fx), round(p.fy),
      ACTIONS.indexOf(p.action), round(p.actionT), round(p.charge), round(p.stamina),
      round(p.tired / p.stats.tiredTime),
    ]),
  };
}

function fromState(s: PlayerState): PlayerView {
  const [id, team, x, y, vx, vy, fx, fy, action, actionT, charge, stamina, tired] = s;
  return { id, team: team ? 'red' : 'gold', x, y, vx, vy, fx, fy, action: ACTIONS[action] ?? 'none', actionT, charge, stamina, tired };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Facing blends round the shorter way, renormalised.
function lerpFacing(a: PlayerView, b: PlayerView, t: number) {
  const fx = lerp(a.fx, b.fx, t);
  const fy = lerp(a.fy, b.fy, t);
  const len = Math.hypot(fx, fy);
  return len > 1e-3 ? { fx: fx / len, fy: fy / len } : { fx: b.fx, fy: b.fy };
}

// The match as seen by a guest: snapshots from the host, drawn a little
// behind the newest one so there's always a pair to blend between.
export class RemoteMatch {
  private snaps: Snapshot[] = [];
  private events: { tick: number; events: SimEvent[] }[] = [];
  // The host tick being drawn, fractional; null until the first snapshot.
  private renderTick: number | null = null;

  push(snap: Snapshot) {
    const newest = this.snaps[this.snaps.length - 1];
    if (newest && snap.tick <= newest.tick) {
      // Unordered channel: a late one slots in, a duplicate is dropped.
      if (this.snaps.some(s => s.tick === snap.tick)) return;
      this.snaps.push(snap);
      this.snaps.sort((a, b) => a.tick - b.tick);
    } else {
      this.snaps.push(snap);
    }
    const target = snap.tick - CONFIG.net.delayTicks;
    if (this.renderTick === null || Math.abs(target - this.renderTick) > CONFIG.net.resyncTicks) this.renderTick = target;
  }

  pushEvents(tick: number, events: SimEvent[]) {
    this.events.push({ tick, events });
  }

  get started() {
    return this.renderTick !== null;
  }

  // Moves the drawn tick on, easing it towards a steady distance behind the
  // newest snapshot; returns the events now due.
  advance(dt: number): SimEvent[] {
    if (this.renderTick === null) return [];
    const newest = this.snaps[this.snaps.length - 1]!;
    const target = newest.tick - CONFIG.net.delayTicks;
    this.renderTick += dt / CONFIG.tick;
    this.renderTick += (target - this.renderTick) * Math.min(1, dt * 2);
    // Keep the pair being drawn and anything newer.
    while (this.snaps.length > 2 && this.snaps[1]!.tick <= this.renderTick) this.snaps.shift();
    const due: SimEvent[] = [];
    while (this.events.length && this.events[0]!.tick <= this.renderTick) due.push(...this.events.shift()!.events);
    return due;
  }

  state(): ViewState | null {
    if (this.renderTick === null) return null;
    const a = this.snaps[0]!;
    const b = this.snaps[1] ?? a;
    const t = b.tick === a.tick ? 0 : Math.max(0, Math.min(1, (this.renderTick - a.tick) / (b.tick - a.tick)));
    const before = new Map(a.players.map(p => [p[0], fromState(p)]));
    const players = b.players.map(raw => {
      const pb = fromState(raw);
      const pa = before.get(pb.id);
      if (!pa) return pb;
      return {
        ...pa,
        x: lerp(pa.x, pb.x, t),
        y: lerp(pa.y, pb.y, t),
        vx: lerp(pa.vx, pb.vx, t),
        vy: lerp(pa.vy, pb.vy, t),
        ...lerpFacing(pa, pb, t),
        actionT: pa.action === pb.action ? lerp(pa.actionT, pb.actionT, t) : pa.actionT,
        charge: lerp(pa.charge, pb.charge, t),
        stamina: lerp(pa.stamina, pb.stamina, t),
        tired: lerp(pa.tired, pb.tired, t),
      };
    });
    return {
      players,
      ballX: lerp(a.ball[0], b.ball[0], t),
      ballY: lerp(a.ball[1], b.ball[1], t),
      score: { gold: b.score[0], red: b.score[1] },
      clock: lerp(a.clock, b.clock, t),
    };
  }
}

// A match run in this tab: fixed steps, drawn between the last two.
export class LocalMatch {
  private prev = new Map<string, { x: number; y: number }>();
  private prevBall = { x: 0, y: 0 };
  private acc = 0;

  constructor(readonly match: Match, private stepOnce: () => SimEvent[]) {
    this.remember();
  }

  private remember() {
    this.prev = new Map(this.match.players.map(p => [p.id, { x: p.x, y: p.y }]));
    this.prevBall = { x: this.match.ball.x, y: this.match.ball.y };
  }

  advance(dt: number): SimEvent[] {
    const events: SimEvent[] = [];
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= CONFIG.tick) {
      this.remember();
      const happened = this.stepOnce();
      events.push(...happened);
      // A kickoff teleports everyone; don't blend across it.
      if (happened.some(e => e.type === 'kickoff')) this.remember();
      this.acc -= CONFIG.tick;
    }
    return events;
  }

  state(): ViewState {
    const t = this.acc / CONFIG.tick;
    const { match } = this;
    return {
      players: match.players.map(p => {
        const from = this.prev.get(p.id) ?? p;
        return {
          id: p.id, team: p.team,
          x: lerp(from.x, p.x, t), y: lerp(from.y, p.y, t),
          vx: p.vx, vy: p.vy, fx: p.fx, fy: p.fy,
          action: p.action, actionT: p.actionT, charge: p.charge,
          stamina: p.stamina, tired: p.tired / p.stats.tiredTime,
        };
      }),
      ballX: lerp(this.prevBall.x, match.ball.x, t),
      ballY: lerp(this.prevBall.y, match.ball.y, t),
      score: { ...match.score },
      clock: match.clock,
    };
  }
}
