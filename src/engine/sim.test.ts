import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { createMatch, createPlayer, step, type Input, type Match, type Player, type SimEvent } from './sim';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const ticks = (seconds: number) => Math.round(seconds / CONFIG.tick);

function setup() {
  const match = createMatch([createPlayer('me', 'gold'), createPlayer('them', 'red')]);
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
  it('lines the teams up in their own halves at kickoff', () => {
    const { match, me, them } = setup();
    expect(me.x).toBeLessThan(0);
    expect(them.x).toBeGreaterThan(0);
    expect(match.ball).toMatchObject({ x: 0, y: 0 });
    expect(match.owner).toBeNull();
  });

  it('runs at run speed and sprints faster', () => {
    const { match, me } = setup();
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
    run(match, 2, { me: { kick: true } });
    const events = run(match, ticks(0.2));
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
    run(match, 2, { me: { kick: true } });
    const events = run(match, ticks(0.4));
    expect(events).toContainEqual({ type: 'steal', player: 'me', from: 'them' });
  });

  it('lets a dribbler shield the ball from a poke behind them', () => {
    const { match, me, them } = setup();
    moveTo(them, 0, 0, 1, 0);
    giveBall(match, them);
    moveTo(me, -(me.r + them.r + 0.3), 0, 1, 0);
    run(match, 2, { me: { kick: true } });
    const events = run(match, ticks(0.4));
    expect(events.some(e => e.type === 'steal')).toBe(false);
    expect(match.owner).toBe('them');
  });

  it('slides on a long press, then gets up slowly', () => {
    const { match, me } = setup();
    moveTo(me, -10, 0);
    const events = run(match, ticks(CONFIG.tackle.tapTime + 0.05), { me: { kick: true } });
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
    expect(events).toContainEqual({ type: 'goal', team: 'gold' });
    expect(match.score).toEqual({ gold: 1, red: 0 });
    // The net holds the ball.
    expect(match.ball.x).toBeLessThanOrEqual(CONFIG.pitch.width / 2 + CONFIG.pitch.goalDepth);

    const later = run(match, ticks(CONFIG.restartDelay) + 1);
    expect(later).toContainEqual({ type: 'kickoff' });
    expect(match.ball).toMatchObject({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(match.score).toEqual({ gold: 1, red: 0 });
  });

  it('scores for red in the gold goal', () => {
    const { match } = setup();
    Object.assign(match.ball, { x: -12, y: 1, vx: -15, vy: 0 });
    expect(run(match, 30)).toContainEqual({ type: 'goal', team: 'red' });
  });
});
