import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { evenAttributes } from '../game/attributes';
import { createMatch, createPlayer, KEEPER_IDS, step, type Input, type Match } from './sim';

const idle: Input = { x: 0, y: 0, kick: false, sprint: false };
const ticks = (s: number) => Math.round(s / CONFIG.tick);
const W = CONFIG.pitch.width / 2;

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Gold's player on the ball, aiming at red's goal (+x) from dist out.
function lineUp(match: Match, dist: number, y: number, ty: number) {
  const me = match.players.find(p => p.id === 'me')!;
  const x = W - dist;
  const dx = W - x;
  const dy = ty - y;
  const l = Math.hypot(dx, dy);
  Object.assign(me, { x, y, vx: 0, vy: 0, fx: dx / l, fy: dy / l });
  Object.assign(match.ball, { x: x + (dx / l) * 0.6, y: y + (dy / l) * 0.6, vx: 0, vy: 0 });
  match.owner = 'me';
  match.kickoffHeld = false;
}

// Shoots with the kick held this long; true if it went in.
function shoot(match: Match, charge: number) {
  for (let k = 0; k < 30; k++) step(match, { me: idle });
  for (let k = 0; k < Math.max(1, ticks(charge)); k++) step(match, { me: { ...idle, kick: true } });
  for (let k = 0; k < ticks(4); k++) {
    if (step(match, { me: idle }).some(e => e.type === 'goal')) return true;
    if (match.owner === KEEPER_IDS.red) return false;
  }
  return false;
}

const keeperMatch = (seed: number) => createMatch([createPlayer('me', 'gold', evenAttributes())], { keepers: true, seed });

describe('goalkeepers', () => {
  it('one a team, on their own line, never taking the kickoff', () => {
    const match = createMatch([createPlayer('a', 'gold'), createPlayer('b', 'red')], { keepers: true, kickoff: 'red' });
    const gk = match.players.find(p => p.id === KEEPER_IDS.red)!;
    expect(gk.keeper).toBe(true);
    expect(gk.x).toBeGreaterThan(W - CONFIG.keeper.boxDepth);
    expect(match.owner).toBe('b');
  });

  it('stays in its small box whatever happens', () => {
    const r = rng(3);
    const match = createMatch([createPlayer('me', 'gold'), createPlayer('them', 'red')], { keepers: true, kickoff: 'gold' });
    match.holdFor = 0;
    for (let i = 0; i < ticks(60); i++) {
      step(match, { me: { x: r() * 2 - 1, y: r() * 2 - 1, kick: r() < 0.2, sprint: r() < 0.5 }, them: { x: r() * 2 - 1, y: r() * 2 - 1, kick: r() < 0.2, sprint: false } });
      for (const gk of match.players.filter(p => p.keeper)) {
        const side = gk.team === 'gold' ? -1 : 1;
        const fromLine = (side * W - gk.x) * side;
        expect(fromLine).toBeGreaterThanOrEqual(-0.21);
        expect(fromLine).toBeLessThanOrEqual(CONFIG.keeper.boxDepth + 0.01);
        expect(Math.abs(gk.y)).toBeLessThanOrEqual(CONFIG.keeper.boxHalf + 0.01);
      }
    }
  });

  it('saves a soft shot at it, then kicks it back out', () => {
    const match = keeperMatch(1);
    lineUp(match, 10, 0, 0);
    expect(shoot(match, 0.05)).toBe(false);
    expect(match.owner).toBe(KEEPER_IDS.red);
    for (let i = 0; i < ticks(3) && match.owner === KEEPER_IDS.red; i++) step(match, { me: idle });
    expect(match.owner).not.toBe(KEEPER_IDS.red);
    // Kicked away from its goal.
    expect(match.ball.vx).toBeLessThan(0);
  });

  it("can't be tackled holding the ball", () => {
    const match = keeperMatch(1);
    const gk = match.players.find(p => p.id === KEEPER_IDS.red)!;
    const me = match.players.find(p => p.id === 'me')!;
    match.kickoffHeld = false;
    Object.assign(match.ball, { x: gk.x - 0.6, y: gk.y, vx: 0, vy: 0 });
    match.owner = gk.id;
    Object.assign(me, { x: gk.x - 1.5, y: gk.y, fx: 1, fy: 0, vx: 0, vy: 0 });
    step(match, { me: { ...idle, kick: true } });
    for (let i = 0; i < ticks(0.4); i++) step(match, { me: idle });
    expect(match.owner).toBe(gk.id);
  });

  it('can be beaten: placed, hard shots go in far more than soft ones', () => {
    const r = rng(11);
    let hard = 0;
    let soft = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      const corner = (r() < 0.5 ? -1 : 1) * (CONFIG.pitch.goalWidth / 2 - 0.45);
      const dist = 6 + r() * 8;
      const y = (r() - 0.5) * 8;
      const a = keeperMatch(i + 1);
      lineUp(a, dist, y, corner);
      if (shoot(a, 0.7)) hard++;
      const b = keeperMatch(i + 1);
      lineUp(b, dist, y, 0);
      if (shoot(b, 0.05)) soft++;
    }
    expect(hard / n).toBeGreaterThan(0.3);
    expect(hard / n).toBeLessThan(0.9);
    expect(soft / n).toBeLessThan(0.15);
  });

  it('keeps the ball when an opponent runs into it', () => {
    const match = createMatch([createPlayer('me', 'gold'), createPlayer('them', 'red')], { keepers: true, seed: 2 });
    match.kickoffHeld = false;
    const gk = match.players.find(p => p.id === KEEPER_IDS.red)!;
    const me = match.players.find(p => p.id === 'me')!;
    Object.assign(match.ball, { x: gk.x - 0.6, y: gk.y, vx: 0, vy: 0 });
    match.owner = gk.id;
    Object.assign(me, { x: gk.x - 3, y: gk.y, fx: 1, fy: 0, vx: 0, vy: 0 });
    for (let i = 0; i < ticks(0.8); i++) step(match, { me: { x: 1, y: 0, kick: false, sprint: true }, them: idle });
    expect(match.owner).toBe(gk.id);
  });

  it('kicks it out away from an opponent standing in the way', () => {
    const match = createMatch([createPlayer('me', 'gold'), createPlayer('them', 'red')], { keepers: true, seed: 2 });
    match.kickoffHeld = false;
    const gk = match.players.find(p => p.id === KEEPER_IDS.red)!;
    const me = match.players.find(p => p.id === 'me')!;
    const them = match.players.find(p => p.id === 'them')!;
    Object.assign(them, { x: -10, y: 8 });
    Object.assign(match.ball, { x: gk.x - 0.6, y: 0, vx: 0, vy: 0 });
    Object.assign(gk, { y: 0, fx: -1, fy: 0 });
    match.owner = gk.id;
    // Straight upfield of it, 4 m out.
    Object.assign(me, { x: gk.x - 4, y: 0, vx: 0, vy: 0 });
    for (let i = 0; i < ticks(3) && match.owner === gk.id; i++) step(match, { me: idle, them: idle });
    expect(match.owner).toBeNull();
    let closest = Infinity;
    for (let i = 0; i < ticks(0.6); i++) {
      step(match, { me: idle, them: idle });
      closest = Math.min(closest, Math.hypot(match.ball.x - me.x, match.ball.y - me.y));
    }
    expect(closest).toBeGreaterThan(1);
  });

  it("dives for a shot it can't reach on its feet", () => {
    let dived = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const match = keeperMatch(seed);
      // Medium pace from 10 m into a corner: there's time to react, not to
      // run across.
      lineUp(match, 10, 0, CONFIG.pitch.goalWidth / 2 - 0.4);
      for (let k = 0; k < 30; k++) step(match, { me: idle });
      for (let k = 0; k < ticks(0.35); k++) step(match, { me: { ...idle, kick: true } });
      for (let k = 0; k < ticks(1); k++) {
        if (step(match, { me: idle }).some(e => e.type === 'slide' && e.player === KEEPER_IDS.red)) {
          dived++;
          break;
        }
      }
    }
    expect(dived).toBeGreaterThan(5);
  });
});
