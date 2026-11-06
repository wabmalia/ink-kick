import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { evenAttributes } from '../game/attributes';
import { createMatch, createPlayer, step, type Input, type Match, type Player, type SimEvent } from './sim';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const ticks = (seconds: number) => Math.round(seconds / CONFIG.tick);

// Tackling 5 against Strength 3: every tackle that reaches wins, so these
// tests don't depend on the dice (stats.test.ts covers riding tackles).
const SURE = { ...evenAttributes(), strength: 3 };

// A loose ball on the spot, so tests place it where they want.
function setup() {
  const match = createMatch([createPlayer('me', 'gold', SURE), createPlayer('them', 'red', SURE)]);
  match.owner = null;
  return { match, me: match.players[0]!, them: match.players[1]! };
}

function run(match: Match, n: number, inputs: Record<string, Partial<Input>> = {}) {
  const events: SimEvent[] = [];
  const full = Object.fromEntries(Object.entries(inputs).map(([id, i]) => [id, { ...idle, ...i }]));
  for (let i = 0; i < n; i++) events.push(...step(match, full));
  return events;
}

// Puts the ball at the player's feet and lets them trap it.
function giveBall(match: Match, p: Player) {
  Object.assign(match.ball, { x: p.x + p.fx * 0.8, y: p.y + p.fy * 0.8, vx: 0, vy: 0 });
  run(match, 1);
  expect(match.owner).toBe(p.id);
}

function moveTo(p: Player, x: number, y: number, fx = 1, fy = 0) {
  Object.assign(p, { x, y, vx: 0, vy: 0, fx, fy });
}

describe('sim', () => {
  it('lines the teams up in their own halves, the kicking team on the ball', () => {
    const match = createMatch([createPlayer('me', 'gold'), createPlayer('mate', 'gold'), createPlayer('them', 'red')], { kickoff: 'red' });
    const [me, mate, them] = match.players;
    expect(me!.x).toBeLessThan(0);
    expect(mate!.x).toBeLessThan(0);
    expect(them!.x).toBeGreaterThan(0);
    expect(match.ball).toMatchObject({ x: 0, y: 0 });
    expect(match.owner).toBe('them');
    expect(them!.x - match.ball.x).toBeCloseTo(CONFIG.dribble.distance);
  });

  it('opens with a coin toss, everyone held still until it lands', () => {
    const match = createMatch([createPlayer('me', 'gold'), createPlayer('them', 'red')], { kickoff: 'gold', coin: true });
    const first = run(match, 1, { me: { x: 1 } });
    expect(first).toEqual([{ type: 'coin', team: 'gold' }]);
    const me = match.players[0]!;
    const startX = me.x;
    run(match, ticks(CONFIG.coinTime) - 2, { me: { x: 1 } });
    expect(me.x).toBe(startX);
    run(match, ticks(0.5), { me: { x: 1 } });
    expect(me.x).toBeGreaterThan(startX);
  });

  it('keeps teams in their halves and defenders out of the circle until the kickoff is taken', () => {
    const match = createMatch([createPlayer('me', 'gold'), createPlayer('mate', 'gold'), createPlayer('them', 'red')], { kickoff: 'gold' });
    const [, mate, them] = match.players;
    // Red charges the kicker; gold's spare man runs for the other half.
    run(match, ticks(2), { them: { x: -1 }, mate: { x: 1 } });
    expect(Math.hypot(them!.x, them!.y)).toBeGreaterThanOrEqual(CONFIG.pitch.centreCircle + them!.r - 1e-9);
    expect(mate!.x).toBeLessThanOrEqual(-mate!.r);
    expect(match.owner).toBe('me');

    // The kicker moves the ball: everyone's free.
    run(match, ticks(0.3), { me: { y: 1 } });
    expect(match.kickoffHeld).toBe(false);
    run(match, ticks(1.5), { them: { x: -1 }, mate: { x: 1 } });
    expect(mate!.x).toBeGreaterThan(0);
    // Red got through the circle it was held out of.
    expect(them!.x).toBeLessThan(CONFIG.pitch.centreCircle);
  });

  it('gives the next kickoff to the team that conceded', () => {
    const { match } = setup();
    Object.assign(match.ball, { x: 12, y: 0, vx: 15, vy: 0 });
    run(match, 30 + ticks(CONFIG.restartDelay) + 1);
    expect(match.score.gold).toBe(1);
    expect(match.owner).toBe('them');
  });

  it('runs at run speed and sprints faster', () => {
    const { match, me } = setup();
    moveTo(me, -10, 0);
    run(match, ticks(0.6), { me: { y: 1 } });
    expect(me.vy).toBeCloseTo(CONFIG.player.runSpeed, 0);
    run(match, ticks(0.6), { me: { y: 1, sprint: true } });
    expect(me.vy).toBeCloseTo(CONFIG.player.sprintSpeed, 0);
  });

  it('gets tired after sprinting dry, then recovers', () => {
    const { match, me } = setup();
    moveTo(me, -14, 0);
    run(match, ticks(1 / CONFIG.stamina.drain + 0.1), { me: { y: 0.0001, x: 0, sprint: true } });
    expect(me.stamina).toBe(0);
    expect(me.tired).toBeGreaterThan(0);
    moveTo(me, -14, 0);
    run(match, ticks(0.6), { me: { y: 1, sprint: true } });
    expect(me.vy).toBeCloseTo(CONFIG.player.tiredSpeed, 0);
    run(match, ticks(CONFIG.stamina.tiredTime));
    expect(me.tired).toBe(0);
    expect(me.stamina).toBeGreaterThan(0);
  });

  it('traps a loose ball on touch and dribbles it ahead', () => {
    const { match, me } = setup();
    giveBall(match, me);
    run(match, ticks(0.5), { me: { x: 1 } });
    expect(match.owner).toBe('me');
    expect(match.ball.x - me.x).toBeCloseTo(CONFIG.dribble.distance, 0);
  });

  it('swings the ball round when the dribbler turns', () => {
    const { match, me } = setup();
    giveBall(match, me);
    run(match, ticks(0.6), { me: { y: -1 } });
    expect(match.owner).toBe('me');
    expect(me.fy).toBeLessThan(-0.9);
    expect(match.ball.y).toBeLessThan(me.y - 0.5);
  });

  it('kicks harder the longer the button is held', () => {
    const launch = (hold: number) => {
      const { match, me } = setup();
      giveBall(match, me);
      run(match, ticks(hold), { me: { kick: true } });
      const events = run(match, 1);
      expect(events.some(e => e.type === 'kick')).toBe(true);
      expect(match.owner).toBeNull();
      return match.ball.vx;
    };
    const pass = launch(0.05);
    const shot = launch(CONFIG.kick.chargeTime);
    expect(pass).toBeGreaterThan(CONFIG.kick.passSpeed * 0.9);
    expect(shot).toBeGreaterThan(CONFIG.kick.shotSpeed * 0.9);
  });

  it('calls a charged kick off with a tap of sprint, keeping the ball', () => {
    const { match, me } = setup();
    giveBall(match, me);
    run(match, ticks(0.4), { me: { kick: true } });
    const feint = run(match, 1, { me: { kick: true, sprint: true } });
    expect(feint).toEqual([{ type: 'feint', player: 'me' }]);
    expect(me.action).toBe('none');
    // Letting go afterwards doesn't kick.
    const after = run(match, ticks(0.3));
    expect(after.some(e => e.type === 'kick')).toBe(false);
    expect(match.owner).toBe('me');
  });

  it('slows the player while charging', () => {
    const { match, me } = setup();
    giveBall(match, me);
    run(match, ticks(0.6), { me: { y: 1, kick: true } });
    expect(me.action).toBe('charge');
    expect(me.vy).toBeLessThan(CONFIG.player.runSpeed * CONFIG.kick.moveFactor + 0.1);
  });

  it('pokes the ball off an opponent with a tap', () => {
    const { match, me, them } = setup();
    moveTo(them, 0, 0, 1, 0);
    giveBall(match, them);
    moveTo(me, match.ball.x + 1.1, 0, -1, 0);
    const events = [...run(match, 2, { me: { kick: true } }), ...run(match, ticks(0.2))];
    expect(events).toContainEqual({ type: 'poke', player: 'me' });
    expect(events).toContainEqual({ type: 'steal', player: 'me', from: 'them' });
    expect(them.cooldown).toBeGreaterThan(0);
    // The ball comes loose towards the poker, who collects it.
    expect(match.owner).toBe('me');
  });

  it('pokes the ball loose round a dribbler from the side', () => {
    const { match, me, them } = setup();
    moveTo(them, 0, 0, 1, 0);
    giveBall(match, them);
    // Level with the dribbler, the ball past them.
    Object.assign(match.ball, { x: 0.9 });
    moveTo(me, 0, -(me.r + them.r + 0.2), 0, 1);
    const events = [...run(match, 2, { me: { kick: true } }), ...run(match, ticks(0.4))];
    expect(events).toContainEqual({ type: 'steal', player: 'me', from: 'them' });
  });

  it('slides instead of poking from behind a dribbler', () => {
    const { match, me, them } = setup();
    moveTo(them, 0, 0, 1, 0);
    giveBall(match, them);
    // On their back, close enough to poke if they were facing the other way.
    moveTo(me, -(me.r + them.r + 0.3), 0, 1, 0);
    const events = run(match, ticks(0.4), { me: { kick: true } });
    expect(events).toContainEqual({ type: 'slide', player: 'me' });
    expect(events.some(e => e.type === 'poke')).toBe(false);
    // Knocked off it, but the ball squirts on ahead of them, not to the slider.
    expect(events).toContainEqual({ type: 'steal', player: 'me', from: 'them' });
    expect(events.some(e => e.type === 'trap' && e.player === 'me')).toBe(false);
    expect(match.ball.x).toBeGreaterThan(them.x);
  });

  it('pokes when the ball is close, whatever the press', () => {
    const { match, me } = setup();
    moveTo(me, -1.2, 0);
    const events = run(match, ticks(0.5), { me: { kick: true } });
    expect(events).toContainEqual({ type: 'poke', player: 'me' });
    expect(events.some(e => e.type === 'slide')).toBe(false);
  });

  it('slides when the ball is out of poke range, then gets up slowly', () => {
    const { match, me } = setup();
    moveTo(me, -10, 0);
    const events = run(match, 2, { me: { kick: true } });
    expect(events).toContainEqual({ type: 'slide', player: 'me' });
    expect(me.vx).toBeGreaterThan(CONFIG.player.sprintSpeed);
    run(match, ticks(CONFIG.tackle.slideTime), { me: { kick: true } });
    expect(me.action).toBe('recover');
    run(match, ticks(0.3), { me: { y: 1 } });
    expect(me.vy).toBeLessThan(CONFIG.player.runSpeed * CONFIG.tackle.recoverFactor + 0.2);
  });

  it('a slide takes the ball and floors its dribbler', () => {
    const { match, me, them } = setup();
    moveTo(them, 0, 0, 1, 0);
    giveBall(match, them);
    moveTo(me, -3, 0);
    const events = run(match, ticks(0.6), { me: { kick: true } });
    expect(events).toContainEqual({ type: 'steal', player: 'me', from: 'them' });
    expect(match.owner).not.toBe('them');
  });

  it('tackling costs stamina; short of it, you still go, and tire', () => {
    const { match, me } = setup();
    moveTo(me, -10, 0);
    me.stamina = 0.5;
    run(match, 1, { me: { kick: true } });
    expect(me.action).toBe('slide');
    expect(me.stamina).toBeCloseTo(0.5 - CONFIG.tackle.slideCost / me.stats.tackleFactor, 2);
    const { match: m2, me: short } = setup();
    moveTo(short, -10, 0);
    short.stamina = CONFIG.tackle.slideCost / 2;
    run(m2, 1, { me: { kick: true } });
    expect(short.action).toBe('slide');
    expect(short.stamina).toBe(0);
    expect(short.tired).toBeGreaterThan(0);
  });

  it('a tired slide is slower and slower to get up from', () => {
    const slide = (tired: boolean) => {
      const { match, me } = setup();
      moveTo(me, -10, 0);
      if (tired) me.tired = 5;
      run(match, 1, { me: { kick: true } });
      const speed = me.vx;
      let down = 0;
      while (me.action !== 'none' && down < 600) {
        run(match, 1);
        down++;
      }
      return { speed, down };
    };
    const fresh = slide(false);
    const tired = slide(true);
    expect(tired.speed).toBeCloseTo(fresh.speed * CONFIG.tackle.tiredSlide, 1);
    expect(tired.down).toBeGreaterThan(fresh.down + ticks(0.3));
  });

  it('winning the ball gives the tackler stamina back and costs the player robbed, less the stronger', () => {
    const robbedLoss = (strength: number) => {
      const { match, me, them } = setup();
      them.stats.holdFactor = 1 + 0.04 * (strength - 5);
      // Sure to win it, however strong they are.
      me.stats.tackleFactor = 2;
      moveTo(them, 0, 0, 1, 0);
      giveBall(match, them);
      moveTo(me, match.ball.x + 1.1, 0, -1, 0);
      me.stamina = 0.5;
      them.stamina = 0.8;
      const events = run(match, 2, { me: { kick: true } });
      for (let i = 0; i < ticks(0.2) && !events.some(e => e.type === 'steal'); i++) events.push(...run(match, 1));
      expect(events).toContainEqual({ type: 'steal', player: 'me', from: 'them' });
      expect(me.stamina).toBeGreaterThan(0.5 - CONFIG.tackle.pokeCost + CONFIG.tackle.stealRefund / 2);
      return 0.8 - them.stamina;
    };
    // (They get a little back each tick not sprinting, so compare.)
    expect(robbedLoss(10)).toBeLessThan(robbedLoss(3));
    expect(robbedLoss(3)).toBeGreaterThan(CONFIG.tackle.robbedCost * 0.8);
  });

  it('a strong player slid into is shoved less and back up sooner', () => {
    const takeOut = (strength: number) => {
      const match = createMatch([createPlayer('me', 'gold', SURE), createPlayer('them', 'red', { ...evenAttributes(), strength })]);
      match.owner = null;
      match.kickoffHeld = false;
      const [me, them] = match.players as [Player, Player];
      Object.assign(match.ball, { x: 0, y: -8, vx: 0, vy: 0 });
      moveTo(me, -6, 3, 1, 0);
      moveTo(them, -4, 3, 1, 0);
      let k = 0;
      while (them.action !== 'stumble' && k++ < 60) run(match, 1, { me: { kick: true } });
      expect(them.action).toBe('stumble');
      const shove = Math.hypot(them.vx, them.vy);
      let down = 0;
      while (them.action === 'stumble' && down < 300) {
        run(match, 1);
        down++;
      }
      return { shove, down };
    };
    const strong = takeOut(10);
    const weak = takeOut(1);
    expect(strong.shove).toBeLessThan(weak.shove);
    expect(strong.down).toBeLessThan(weak.down - ticks(0.3));
  });

  it('turns round quickly once it stops going the way it faces', () => {
    const { match, me } = setup();
    Object.assign(match.ball, { x: 0, y: -8 });
    moveTo(me, -8, 0);
    me.vx = CONFIG.player.sprintSpeed;
    let k = 0;
    while (me.fx > -0.98 && k < 60) {
      run(match, 1, { me: { x: -1, y: 0.001, sprint: true } });
      k++;
    }
    expect(k).toBeLessThan(ticks(0.35));
  });

  it('a hard turn still happens when the keys roll round to the new way', () => {
    for (const [ball, sprint, steps] of [[false, true, 2], [true, true, 2], [false, false, 5], [true, false, 5]] as const) {
      const { match, me, them } = setup();
      moveTo(them, 10, 8);
      moveTo(me, -8, -3, Math.SQRT1_2, Math.SQRT1_2);
      match.kickoffHeld = false;
      if (ball) giveBall(match, me);
      else Object.assign(match.ball, { x: 0, y: -8 });
      run(match, 50, { me: { x: 1, y: 1, sprint } });
      // Up and right to down and left, a finger at a time.
      run(match, steps, { me: { x: 1, y: 0, sprint } });
      run(match, 1, { me: { sprint } });
      run(match, steps, { me: { x: 0, y: -1, sprint } });
      let turned = false;
      for (let i = 0; i < 10; i++) {
        run(match, 1, { me: { x: -1, y: -1, sprint } });
        if (me.turnBack) turned = true;
      }
      expect(turned, `ball ${ball}, sprint ${sprint}`).toBe(true);
    }
  });

  it('deadens a shot that hits a player', () => {
    const { match, me } = setup();
    moveTo(me, 0, 0, -1, 0);
    me.cooldown = 1;
    Object.assign(match.ball, { x: 3, y: 0, vx: -20, vy: 0 });
    run(match, 20);
    expect(Math.abs(match.ball.vx)).toBeLessThan(2.5);
    expect(Math.hypot(match.ball.x - me.x, match.ball.y - me.y)).toBeLessThan(1.5);
  });

  it('keeps the ball after sliding onto it', () => {
    const { match, me } = setup();
    moveTo(me, -10, 0);
    Object.assign(match.ball, { x: -7, y: 0, vx: 0, vy: 0 });
    const events = run(match, ticks(0.5), { me: { kick: true } });
    expect(events).toContainEqual({ type: 'slide', player: 'me' });
    expect(match.owner).toBe('me');
    expect(match.ball.x).toBeGreaterThan(me.x);
  });

  it('knocks the ball on when a slide only clips it', () => {
    const { match, me } = setup();
    moveTo(me, -10, 0);
    Object.assign(match.ball, { x: -7, y: 0.95, vx: 0, vy: 0 });
    run(match, ticks(0.5), { me: { kick: true } });
    expect(match.owner).toBeNull();
    expect(match.ball.vx).toBeGreaterThan(3);
  });

  it('bounces the ball off the side line', () => {
    const { match } = setup();
    Object.assign(match.ball, { x: 5, y: 7, vx: 0, vy: 15 });
    run(match, 20);
    expect(match.ball.vy).toBeLessThan(0);
    expect(match.ball.y).toBeLessThanOrEqual(CONFIG.pitch.height / 2 - match.ball.r);
  });

  it('bounces the ball off the end line outside the goal mouth', () => {
    const { match } = setup();
    Object.assign(match.ball, { x: 12, y: 5, vx: 15, vy: 0 });
    const events = run(match, 20);
    expect(match.ball.vx).toBeLessThan(0);
    expect(events.some(e => e.type === 'goal')).toBe(false);
  });

  it('scores for the attacking team, then restarts from kickoff', () => {
    const { match } = setup();
    Object.assign(match.ball, { x: 12, y: 0, vx: 15, vy: 0 });
    const events = run(match, 30);
    expect(events).toContainEqual(expect.objectContaining({ type: 'goal', team: 'gold' }));
    expect(match.score).toEqual({ gold: 1, red: 0 });
    // The net holds the ball.
    expect(match.ball.x).toBeLessThanOrEqual(CONFIG.pitch.width / 2 + CONFIG.pitch.goalDepth);

    const later = run(match, ticks(CONFIG.restartDelay) + 1);
    expect(later).toContainEqual({ type: 'kickoff' });
    expect(match.ball).toMatchObject({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(match.score).toEqual({ gold: 1, red: 0 });
  });

  it("doesn't score when the ball is dribbled over the end line beside the goal", () => {
    const { match, me } = setup();
    moveTo(me, 12, 5);
    giveBall(match, me);
    const events = run(match, ticks(1.5), { me: { x: 1 } });
    expect(events.some(e => e.type === 'goal')).toBe(false);
    expect(match.ball.x).toBeLessThanOrEqual(CONFIG.pitch.width / 2 - match.ball.r);
  });

  it('scores for red in the gold goal', () => {
    const { match } = setup();
    Object.assign(match.ball, { x: -12, y: 1, vx: -15, vy: 0 });
    expect(run(match, 30)).toContainEqual(expect.objectContaining({ type: 'goal', team: 'red' }));
  });

  it('turning back with the ball stops, pivots and goes back along the same line', () => {
    for (const sprint of [false, true]) {
      const { match, me, them } = setup();
      moveTo(them, 10, 8);
      moveTo(me, -6, 0);
      match.kickoffHeld = false;
      giveBall(match, me);
      run(match, 60, { me: { x: 1, sprint } });
      const y0 = me.y;
      const x0 = me.x;
      let wide = 0;
      let past = 0;
      for (let i = 0; i < ticks(1); i++) {
        run(match, 1, { me: { x: -1, sprint } });
        wide = Math.max(wide, Math.abs(me.y - y0));
        past = Math.max(past, me.x - x0);
        expect(match.owner).toBe('me');
      }
      // Along the same line: it used to loop 2 to 3 m wide and run 1.3 to
      // 1.9 m on at a run. A hard turn's slide on is fine.
      expect(wide).toBeLessThan(0.1);
      expect(past).toBeLessThan(1.4);
      expect(me.vx).toBeLessThan(-3);
    }
  });

  it('credits the goal to whoever kicked it last, and spots an own goal', () => {
    const { match, me, them } = setup();
    moveTo(me, 10, 0);
    moveTo(them, 0, 6);
    giveBall(match, me);
    run(match, ticks(0.3), { me: { kick: true } });
    const events = run(match, ticks(1), { me: { kick: false } });
    const goal = events.find(e => e.type === 'goal');
    expect(goal).toMatchObject({ team: 'gold', scorer: 'me', own: false });

    // Red's player shoots into red's own net (at +x): gold's goal, an own goal.
    const b = setup();
    moveTo(b.them, 10, 0, 1, 0);
    moveTo(b.me, 0, 6);
    giveBall(b.match, b.them);
    run(b.match, ticks(0.3), { them: { kick: true } });
    const own = run(b.match, ticks(1), { them: { kick: false } }).find(e => e.type === 'goal');
    expect(own).toMatchObject({ team: 'gold', scorer: 'them', own: true });
  });

  it('ends a first-to match at the target, with every goal on the scoreboard', () => {
    const { match } = setup();
    match.rules = { kind: 'first', goals: 2 };
    const shoot = () => {
      Object.assign(match.ball, { x: 12, y: 0, vx: 15, vy: 0 });
      match.owner = null;
      return run(match, 30);
    };
    expect(shoot().some(e => e.type === 'end')).toBe(false);
    run(match, ticks(CONFIG.restartDelay) + 1);
    const events = shoot();
    expect(events).toContainEqual(expect.objectContaining({ type: 'end', winner: 'gold', score: { gold: 2, red: 0 } }));
    const end = events.find(e => e.type === 'end') as Extract<typeof events[number], { type: 'end' }>;
    expect(end.goals).toHaveLength(2);
    expect(end.goals[1]!.at).toBeGreaterThan(end.goals[0]!.at);
    // Over: nothing moves any more.
    const x = match.players[0]!.x;
    run(match, 30, { me: { x: 1 } });
    expect(match.players[0]!.x).toBe(x);
  });

  it('ends a timed match when the clock runs out, or at the next goal if level', () => {
    const { match } = setup();
    match.rules = { kind: 'timed', seconds: 2 };
    // Level at full time: plays on.
    expect(run(match, ticks(2.5)).some(e => e.type === 'end')).toBe(false);
    expect(match.over).toBeNull();
    // Golden goal.
    Object.assign(match.ball, { x: -12, y: 1, vx: -15, vy: 0 });
    match.owner = null;
    expect(run(match, 30)).toContainEqual(expect.objectContaining({ type: 'end', winner: 'red' }));

    const b = setup();
    b.match.rules = { kind: 'timed', seconds: 2 };
    b.match.score.gold = 1;
    expect(run(b.match, ticks(2.1))).toContainEqual(expect.objectContaining({ type: 'end', winner: 'gold' }));
  });

  it("can't turn while powering up a kick", () => {
    const { match, me, them } = setup();
    moveTo(them, 10, 8);
    moveTo(me, -6, 0);
    match.kickoffHeld = false;
    giveBall(match, me);
    run(match, 2, { me: { kick: true } });
    expect(me.action).toBe('charge');
    run(match, ticks(0.5), { me: { kick: true, y: -1 } });
    expect(me.fx).toBeCloseTo(1, 5);
    expect(Math.abs(me.y)).toBeLessThan(0.01);
  });

  it('curls a kick the way you hold just after it, more with more Power', () => {
    // Where the ball is, across its path, 1.2 s after a half-power kick to
    // the right, holding up (-y), down or nothing.
    const across = (hold: number, power = 5) => {
      const match = createMatch([createPlayer('me', 'gold', { ...SURE, power }), createPlayer('them', 'red', SURE)]);
      match.owner = null;
      match.kickoffHeld = false;
      const [me, them] = match.players;
      moveTo(them!, 10, 8);
      moveTo(me!, -10, 0);
      giveBall(match, me!);
      run(match, ticks(0.35), { me: { kick: true } });
      run(match, ticks(1.2), { me: { y: hold } });
      return match.ball.y;
    };
    expect(Math.abs(across(0))).toBeLessThan(0.3);
    expect(across(-1)).toBeLessThan(-1);
    expect(across(1)).toBeGreaterThan(1);
    expect(Math.abs(across(-1, 10))).toBeGreaterThan(Math.abs(across(-1, 1)) * 1.3);
  });

  it('curls fully holding right on a kick up and to the right', () => {
    const bend = (hold: { x: number; y: number }) => {
      const match = createMatch([createPlayer('me', 'gold', SURE), createPlayer('them', 'red', SURE)]);
      match.owner = null;
      match.kickoffHeld = false;
      const [me, them] = match.players;
      moveTo(them!, 10, 8);
      const d = Math.SQRT1_2;
      moveTo(me!, -8, 4, d, -d);
      giveBall(match, me!);
      run(match, ticks(0.35), { me: { kick: true } });
      const x0 = match.ball.x;
      const y0 = match.ball.y;
      run(match, ticks(1), { me: hold });
      // How far right of the straight line (up and right) it ended up.
      return ((match.ball.x - x0) * d + (match.ball.y - y0) * d);
    };
    const sideways = bend({ x: 1, y: 1 });
    const right = bend({ x: 1, y: 0 });
    expect(right).toBeGreaterThan(0.5);
    expect(right).toBeCloseTo(sideways, 1);
  });

  it("a ball at your back isn't picked up; it drops at your heels and you turn to take it", () => {
    const m = createMatch([createPlayer('me', 'gold')], { practice: true });
    const me = m.players[0]!;
    Object.assign(me, { x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0 });
    // Rolling into your heels.
    Object.assign(m.ball, { x: -1.2, y: 0.1, vx: 3, vy: 0 });
    let fastest = 0;
    for (let i = 0; i < ticks(0.7); i++) {
      step(m, { me: idle });
      if (i > ticks(0.25)) fastest = Math.max(fastest, Math.hypot(m.ball.vx, m.ball.vy));
    }
    expect(m.owner).toBeNull();
    expect(fastest).toBeLessThan(1);
    expect(Math.hypot(m.ball.x - me.x, m.ball.y - me.y)).toBeLessThan(1.1);
    // Turn to it: now it's yours, and stays at your feet.
    for (let i = 0; i < ticks(0.8); i++) {
      const dx = m.ball.x - me.x;
      const dy = m.ball.y - me.y;
      const l = Math.hypot(dx, dy) || 1;
      step(m, { me: m.owner ? idle : { ...idle, x: dx / l, y: dy / l } });
    }
    expect(m.owner).toBe('me');
    expect(Math.hypot(m.ball.x - me.x, m.ball.y - me.y)).toBeLessThan(1);
  });

  it('a ball taken at the edge of your reach, 55 degrees round, is kept', () => {
    const a = (55 * Math.PI) / 180;
    const m = createMatch([createPlayer('me', 'gold')], { practice: true });
    const me = m.players[0]!;
    Object.assign(me, { x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0 });
    const d = me.r + m.ball.r + CONFIG.dribble.reach - 0.01;
    Object.assign(m.ball, { x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0 });
    for (let i = 0; i < ticks(0.5); i++) step(m, { me: idle });
    expect(m.owner).toBe('me');
  });

  it('running off the pitch with the ball leaves it at the line, not flying back in', () => {
    const H = CONFIG.pitch.height / 2;
    for (const ix of [0, 0.7]) {
      const m = createMatch([createPlayer('me', 'gold')], { practice: true });
      const me = m.players[0]!;
      const l = Math.hypot(ix, 1);
      Object.assign(me, { x: 0, y: H - 3, vx: 0, vy: 0, fx: ix / l, fy: 1 / l });
      Object.assign(m.ball, { x: me.x + me.fx * 0.6, y: me.y + me.fy * 0.6, vx: 0, vy: 0 });
      m.owner = 'me';
      let fastest = 0;
      for (let i = 0; i < ticks(2); i++) {
        step(m, { me: { ...idle, x: ix, y: 1, sprint: true } });
        if (!m.owner) fastest = Math.max(fastest, Math.hypot(m.ball.vx, m.ball.vy));
      }
      expect(m.owner).toBeNull();
      // No faster than you were running.
      expect(fastest).toBeLessThan(CONFIG.player.sprintSpeed);
    }
  });

  it('a curled kick bends so far and no further, never looping round', () => {
    const m = createMatch([createPlayer('me', 'gold', { ...evenAttributes(), power: 10 })], { practice: true });
    const me = m.players[0]!;
    Object.assign(me, { x: -12, y: 8, vx: 0, vy: 0, fx: 1, fy: 0 });
    Object.assign(m.ball, { x: -11.4, y: 8, vx: 0, vy: 0 });
    m.owner = 'me';
    for (let i = 0; i < ticks(1.5); i++) step(m, { me: { ...idle, kick: true } });
    let most = 0;
    for (let i = 0; i < ticks(3); i++) {
      step(m, { me: { ...idle, y: -1 } });
      most = Math.max(most, Math.abs(m.curled));
    }
    expect(most).toBeGreaterThan(CONFIG.kick.maxTurn * 0.9);
    expect(most).toBeLessThanOrEqual(CONFIG.kick.maxTurn + 1e-6);
  });
});
