import { describe, expect, it } from 'vitest';
import { BUTTON_D, DEFAULT_LAYOUT, fitLayout, GAP, moveButton, resizeButton, resizeStick, STICK_D, TOP_CLEAR, type TouchLayout } from './touch-layout';

const W = 844;
const H = 390;
const apart = (l: TouchLayout) => Math.hypot(l.kick.x - l.sprint.x, l.kick.y - l.sprint.y) >= (l.kick.d + l.sprint.d) / 2 + GAP;

describe('touch layout', () => {
  it('starts where the buttons always were, apart', () => {
    expect(apart(DEFAULT_LAYOUT)).toBe(true);
  });

  it('moves a button where it is dragged', () => {
    const l = moveButton(DEFAULT_LAYOUT, 'kick', 120, 140, W, H);
    expect(l.kick).toMatchObject({ x: 120, y: 140 });
  });

  it('keeps buttons in the right half, on screen and under the top buttons', () => {
    const l = moveButton(DEFAULT_LAYOUT, 'kick', 2000, 2000, W, H);
    expect(l.kick.x + l.kick.d / 2).toBeLessThanOrEqual(W / 2);
    expect(l.kick.y + l.kick.d / 2).toBeLessThanOrEqual(H - TOP_CLEAR);
    const low = moveButton(DEFAULT_LAYOUT, 'kick', -50, -50, W, H);
    expect(low.kick.x - low.kick.d / 2).toBeGreaterThanOrEqual(0);
    expect(low.kick.y - low.kick.d / 2).toBeGreaterThanOrEqual(0);
  });

  it('never lets one button sit on the other', () => {
    const l = moveButton(DEFAULT_LAYOUT, 'kick', DEFAULT_LAYOUT.sprint.x, DEFAULT_LAYOUT.sprint.y + 5, W, H);
    expect(apart(l)).toBe(true);
    const big = resizeButton(DEFAULT_LAYOUT, 'kick', 500, W, H);
    expect(apart(big)).toBe(true);
    expect(big.kick.d).toBeGreaterThan(DEFAULT_LAYOUT.kick.d);
  });

  it('grows and shrinks within limits', () => {
    const far = moveButton(DEFAULT_LAYOUT, 'kick', 80, 200, W, H);
    expect(resizeButton(far, 'kick', 500, W, H).kick.d).toBe(BUTTON_D[1]);
    expect(resizeButton(far, 'kick', 1, W, H).kick.d).toBe(BUTTON_D[0]);
    expect(resizeStick(DEFAULT_LAYOUT, 999).stick.d).toBe(STICK_D[1]);
    expect(resizeStick(DEFAULT_LAYOUT, 1).stick.d).toBe(STICK_D[0]);
  });

  it('fits a saved layout to a smaller screen, and drops a broken one', () => {
    const saved = moveButton(DEFAULT_LAYOUT, 'kick', 300, 250, 1000, 460);
    const small = fitLayout(saved, 667, 320);
    expect(small.kick.x + small.kick.d / 2).toBeLessThanOrEqual(667 / 2);
    expect(small.kick.y + small.kick.d / 2).toBeLessThanOrEqual(320 - TOP_CLEAR);
    expect(fitLayout('nonsense', W, H)).toEqual(DEFAULT_LAYOUT);
    expect(fitLayout({ kick: { x: 50, y: 50, d: 60 }, sprint: { x: 52, y: 52, d: 60 } }, W, H)).toEqual(DEFAULT_LAYOUT);
  });
});
