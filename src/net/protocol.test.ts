import { describe, expect, it } from 'vitest';
import { cleanInput, cleanName, cleanPings, NAME_MAX, normalizeCode, pingLevel, validTeam } from './protocol';

// All of these check what arrives from other people's browsers.
describe('cleaning what other browsers send', () => {
  it('room codes: upper case, letters and digits only, five at most', () => {
    expect(normalizeCode('ab c-1')).toBe('ABC1');
    expect(normalizeCode('abcdefgh')).toBe('ABCDE');
    expect(normalizeCode('')).toBe('');
  });

  it('names: no control characters, trimmed, capped, never empty', () => {
    expect(cleanName('  Ana\u0000​  ')).toBe('Ana');
    expect(cleanName('x'.repeat(40))).toHaveLength(NAME_MAX);
    expect(cleanName('')).toBe('Player');
    expect(cleanName(undefined)).toBe('Player');
    expect(cleanName({ toString: () => 'Bo' })).toBe('Bo');
  });

  it('inputs: junk refused, directions held to -1..1, buttons only when true', () => {
    expect(cleanInput(null)).toBeNull();
    expect(cleanInput('kick')).toBeNull();
    expect(cleanInput({ seq: 1, x: NaN, y: 0 })).toBeNull();
    expect(cleanInput({ seq: 1, x: 0, y: Infinity })).toBeNull();
    expect(cleanInput({ x: 0, y: 0 })).toBeNull();
    expect(cleanInput({ seq: 3, x: 5, y: -9, kick: 'yes', sprint: true })).toEqual({ seq: 3, x: 1, y: -1, kick: false, sprint: true });
  });

  it('teams: only gold or red', () => {
    expect(validTeam('gold')).toBe(true);
    expect(validTeam('red')).toBe(true);
    expect(validTeam('blue')).toBe(false);
    expect(validTeam(undefined)).toBe(false);
  });

  it('round trips: whole ms, believable numbers only', () => {
    expect(cleanPings({ a: 41.6, b: -1, c: '9', d: NaN, e: 20_000, f: 0 })).toEqual({ a: 42, f: 0 });
    expect(cleanPings(null)).toEqual({});
    expect(cleanPings('x')).toEqual({});
  });
});

describe('ping levels', () => {
  it('good under 80 ms, fair under 150, poor beyond', () => {
    expect([0, 79, 80, 149, 150, 900].map(pingLevel)).toEqual(['good', 'good', 'fair', 'fair', 'poor', 'poor']);
  });
});
