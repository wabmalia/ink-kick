import { CONFIG } from '../config';
import type { Match, SimEvent } from '../engine/sim';
import type { PlayerView, ViewState } from '../game/state';
import { lerp } from '../math';
import type { Run } from './scenarios';

// Plays a lab run at fixed steps and draws it between the last two, like
// LocalMatch, but over every match the run has going (the slalom's two
// lanes each have their own ball), and coping with the run swapping its
// match for a fresh one (the shooting range does, shot to shot).

export class Playback {
  private acc = 0;
  private prev = new Map<string, { x: number; y: number }>();
  private prevBalls: { x: number; y: number }[] = [];
  private seen: Match[] = [];

  constructor(private run: Run) {
    this.remember();
  }

  private matches() {
    return [this.run.match, ...(this.run.extra ?? [])];
  }

  private remember() {
    this.seen = this.matches();
    this.prev.clear();
    for (const m of this.seen) for (const p of m.players) this.prev.set(p.id, { x: p.x, y: p.y });
    this.prevBalls = this.seen.map(m => ({ x: m.ball.x, y: m.ball.y }));
  }

  advance(dt: number): SimEvent[] {
    const events: SimEvent[] = [];
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= CONFIG.tick) {
      this.remember();
      if (!this.run.done) events.push(...this.run.step());
      // A fresh match: nothing to blend from.
      const now = this.matches();
      if (now.some((m, i) => m !== this.seen[i])) this.remember();
      this.acc -= CONFIG.tick;
    }
    return events;
  }

  state(): ViewState {
    const t = this.acc / CONFIG.tick;
    const matches = this.matches();
    const players: PlayerView[] = matches.flatMap(m => m.players.map(p => {
      const from = this.prev.get(p.id) ?? p;
      return {
        id: p.id, team: this.run.kits?.[p.id] ?? p.team,
        x: lerp(from.x, p.x, t), y: lerp(from.y, p.y, t),
        vx: p.vx, vy: p.vy, fx: p.fx, fy: p.fy,
        action: p.action, actionT: p.actionT, charge: p.charge,
        stamina: p.stamina, tired: p.tired / p.stats.tiredTime,
        stumble: p.action === 'stumble' ? p.stats.stumbleTime : 0,
        sprinting: p.sprinting,
      };
    }));
    const balls = matches.map((m, i) => {
      const from = this.prevBalls[i] ?? m.ball;
      return { x: lerp(from.x, m.ball.x, t), y: lerp(from.y, m.ball.y, t) };
    });
    return {
      players,
      ballX: balls[0]!.x,
      ballY: balls[0]!.y,
      props: balls.slice(1),
      cones: this.run.cones,
      aim: this.run.aim,
      score: { gold: 0, red: 0 },
    };
  }
}
