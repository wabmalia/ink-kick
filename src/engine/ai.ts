import { CONFIG } from '../config';
import type { Input, Match } from './sim';

const KICKOFF_WAIT = 0.8;

// A simple opponent that plays through the same Input as a person: chase the
// loose ball, dribble at goal and shoot from range, and poke or slide at
// whoever has the ball. Deliberately beatable.
export class Bot {
  // Keeps the button down this much longer, for charges and slides.
  private holdFor = 0;
  private tackleWait = 0;
  // Where in the goal mouth this possession aims.
  private aimY = 0;
  private hadBall = false;
  // Hesitates at each kickoff, so a person can get to the ball first.
  private waitFor = KICKOFF_WAIT;

  constructor(readonly id: string) {}

  think(match: Match): Input {
    const dt = CONFIG.tick;
    const me = match.players.find(p => p.id === this.id)!;
    const { ball } = match;
    const { width, goalWidth } = CONFIG.pitch;
    this.tackleWait = Math.max(0, this.tackleWait - dt);
    this.waitFor = Math.max(0, this.waitFor - dt);
    if (match.restartIn > 0) {
      this.holdFor = 0;
      this.waitFor = KICKOFF_WAIT;
    }
    if (match.restartIn > 0 || this.waitFor > 0) return { x: 0, y: 0, kick: false, sprint: false };

    const hasBall = match.owner === me.id;
    if (hasBall && !this.hadBall) this.aimY = (Math.random() - 0.5) * (goalWidth - 1.2);
    this.hadBall = hasBall;

    let tx = ball.x;
    let ty = ball.y;
    let sprint = false;
    const toBall = Math.hypot(ball.x - me.x, ball.y - me.y);

    if (hasBall) {
      tx = (me.team === 'gold' ? 1 : -1) * width / 2;
      ty = this.aimY;
      const toGoal = Math.hypot(tx - me.x, ty - me.y);
      const aligned = (me.fx * (tx - me.x) + me.fy * (ty - me.y)) / toGoal > 0.92;
      sprint = toGoal > 12 && me.stamina > 0.5;
      if (toGoal < 11 && aligned && this.holdFor <= 0 && me.action === 'none') {
        this.holdFor = me.stats.chargeTime * Math.min(1, 0.35 + toGoal / 14);
      }
    } else if (match.owner) {
      sprint = toBall > 3 && me.stamina > 0.3;
      if (this.tackleWait <= 0 && me.action === 'none') {
        // Hesitates in range before poking, so it can be dribbled past;
        // now and then slides in from a little further out.
        if (toBall < 1.25 && Math.random() < 0.025) {
          this.holdFor = CONFIG.tick;
          this.tackleWait = 1.5;
        } else if (toBall > 2.4 && toBall < 3.4 && Math.random() < 0.02) {
          this.holdFor = CONFIG.tick;
          this.tackleWait = 2;
        }
      }
    } else {
      sprint = toBall > 4 && me.stamina > 0.4;
    }

    const kick = this.holdFor > 0;
    this.holdFor = Math.max(0, this.holdFor - dt);
    const dx = tx - me.x;
    const dy = ty - me.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.2) return { x: 0, y: 0, kick, sprint: false };
    return { x: dx / len, y: dy / len, kick, sprint };
  }
}
