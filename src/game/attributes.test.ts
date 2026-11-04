import { describe, expect, it } from 'vitest';
import { ATTRIBUTES, canLower, canRaise, cleanAttributes, evenAttributes, lower, raise, spare, TOTAL, type Attributes } from './attributes';

const sum = (a: Attributes) => ATTRIBUTES.reduce((s, k) => s + a[k], 0);

describe('attributes', () => {
  it('start even, five each, nothing to spend', () => {
    const a = evenAttributes();
    expect(ATTRIBUTES.every(k => a[k] === 5)).toBe(true);
    expect(sum(a)).toBe(TOTAL);
    expect(spare(a)).toBe(0);
  });

  it('can only raise once a point has been freed', () => {
    let a = evenAttributes();
    expect(canRaise(a, 'pace')).toBe(false);
    expect(raise(a, 'pace')).toBe(a);
    a = lower(a, 'strength');
    expect(spare(a)).toBe(1);
    a = raise(a, 'pace');
    expect(a.pace).toBe(6);
    expect(a.strength).toBe(4);
    expect(spare(a)).toBe(0);
  });

  it('attributes and spare points always add up to 30', () => {
    let a = evenAttributes();
    for (let i = 0; i < 20; i++) a = lower(a, ATTRIBUTES[i % 6]!);
    for (let i = 0; i < 40; i++) a = raise(a, 'pace');
    expect(sum(a) + spare(a)).toBe(TOTAL);
  });

  it('keeps every attribute between 1 and 10', () => {
    let a = evenAttributes();
    for (let i = 0; i < 6; i++) a = lower(a, 'power');
    expect(a.power).toBe(1);
    expect(canLower(a, 'power')).toBe(false);
    for (let i = 0; i < 4; i++) a = lower(a, 'strength');
    for (let i = 0; i < 9; i++) a = raise(a, 'pace');
    expect(a.pace).toBe(10);
    expect(canRaise(a, 'pace')).toBe(false);
    expect(spare(a)).toBe(3);
  });

  it('rejects stored values that break the rules', () => {
    expect(cleanAttributes({ pace: 10, stamina: 10, dribbling: 10, power: 10, tackling: 10, strength: 10 })).toEqual(evenAttributes());
    expect(cleanAttributes({ pace: 0.5 })).toEqual(evenAttributes());
    expect(cleanAttributes('nonsense')).toEqual(evenAttributes());
    const good = { pace: 8, stamina: 6, dribbling: 5, power: 5, tackling: 3, strength: 3 };
    expect(cleanAttributes(good)).toEqual(good);
    // Unspent points are kept.
    const unspent = { ...good, pace: 6 };
    expect(cleanAttributes(unspent)).toEqual(unspent);
  });
});
