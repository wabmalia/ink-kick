import { describe, expect, it } from 'vitest';
import { DEAD_ZONE, FLICK_SPEED, fingerSpeed, STICK_REACH, stickCentre, stickDirection } from './touch';

describe('stickDirection', () => {
  it('ignores a thumb resting near the centre', () => {
    expect(stickDirection(0, 0, 48)).toEqual({ x: 0, y: 0 });
    expect(stickDirection(48 * DEAD_ZONE * 0.9, 0, 48)).toEqual({ x: 0, y: 0 });
  });

  it('points where the thumb is, down the screen as +y', () => {
    const d = stickDirection(0, -30, 48);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeLessThan(0);
    const r = stickDirection(30, 30, 48);
    expect(r.x).toBeCloseTo(r.y);
  });

  it('caps the length at 1 past the rim', () => {
    const d = stickDirection(300, 400, 48);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(d.x / d.y).toBeCloseTo(0.75);
  });

  it('keeps any angle, not just eight', () => {
    const d = stickDirection(40, 10, 48);
    expect(Math.atan2(d.y, d.x)).toBeCloseTo(Math.atan2(10, 40));
  });
});

describe('fingerSpeed', () => {
  it('tells a flick from a drift', () => {
    // Kick to Sprint is about 70 px: a flick does it in a tenth of a second...
    const flick = [{ x: 0, y: 0, t: 0 }, { x: -35, y: 5, t: 50 }, { x: -70, y: 10, t: 100 }];
    expect(fingerSpeed(flick)).toBeGreaterThan(FLICK_SPEED);
    // ...a thumb drifting over takes most of a second.
    const drift = [{ x: 0, y: 0, t: 0 }, { x: -20, y: 3, t: 250 }, { x: -45, y: 6, t: 500 }, { x: -70, y: 10, t: 750 }];
    expect(fingerSpeed(drift)).toBeLessThan(FLICK_SPEED);
  });

  it('only looks at the last moment, not a slow start', () => {
    const late = [{ x: 0, y: 0, t: 0 }, { x: -5, y: 0, t: 600 }, { x: -70, y: 0, t: 680 }];
    expect(fingerSpeed(late)).toBeGreaterThan(FLICK_SPEED);
  });

  it('is zero with nothing to go on', () => {
    expect(fingerSpeed([])).toBe(0);
    expect(fingerSpeed([{ x: 3, y: 3, t: 10 }])).toBe(0);
  });
});

describe('stickCentre', () => {
  it('goes where the thumb lands', () => {
    expect(stickCentre(200, 250, 844, 390)).toEqual({ x: 200, y: 250 });
  });

  it('keeps the whole stick on screen', () => {
    const c = stickCentre(2, 389, 844, 390);
    expect(c.x).toBeGreaterThanOrEqual(STICK_REACH);
    expect(c.y).toBeLessThanOrEqual(390 - STICK_REACH);
  });
});
