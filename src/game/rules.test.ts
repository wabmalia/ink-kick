import { describe, expect, it } from 'vitest';
import { cleanRules, DEFAULT_RULES, RULE_OPTIONS, rulesLine, rulesName } from './rules';

describe('match rules', () => {
  it('takes only rules on offer, from storage or another browser', () => {
    for (const o of RULE_OPTIONS) expect(cleanRules(JSON.parse(JSON.stringify(o.rules)))).toEqual(o.rules);
    expect(cleanRules({ kind: 'first', goals: 99 })).toEqual(DEFAULT_RULES);
    expect(cleanRules({ kind: 'endless' })).toEqual(DEFAULT_RULES);
    expect(cleanRules('nonsense')).toEqual(DEFAULT_RULES);
    expect(cleanRules(null)).toEqual(DEFAULT_RULES);
    // A copy, so changing it can't change the options.
    expect(cleanRules(RULE_OPTIONS[0]!.rules)).not.toBe(RULE_OPTIONS[0]!.rules);
  });

  it('names how the match is won', () => {
    expect(rulesName({ kind: 'first', goals: 5 })).toBe('First to 5');
    expect(rulesName({ kind: 'timed', seconds: 180 })).toBe('3 min match');
    expect(rulesName({ kind: 'endless' })).toBe('');
  });

  it('counts down to match point, or the clock to a golden goal', () => {
    const first5 = { kind: 'first', goals: 5 } as const;
    expect(rulesLine(first5, 0, { gold: 0, red: 0 })).toBe('5 to win');
    expect(rulesLine(first5, 0, { gold: 1, red: 3 })).toBe('2 to win');
    expect(rulesLine(first5, 0, { gold: 4, red: 2 })).toBe('Match point');
    const timed = { kind: 'timed', seconds: 180 } as const;
    expect(rulesLine(timed, 50.4, { gold: 0, red: 0 })).toBe('2:09');
    expect(rulesLine(timed, 180, { gold: 1, red: 1 })).toBe('Golden goal');
  });
});
