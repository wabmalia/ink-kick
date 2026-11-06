import type { Rules } from '../engine/sim';
import { KEYS, store } from '../storage';

// The match lengths on offer before a kickoff, and how each reads on the
// scoreboard.

export interface RuleOption {
  id: string;
  label: string;
  rules: Rules;
}

export const RULE_OPTIONS: RuleOption[] = [
  { id: 'ft3', label: 'First to 3', rules: { kind: 'first', goals: 3 } },
  { id: 'ft5', label: 'First to 5', rules: { kind: 'first', goals: 5 } },
  { id: 'ft7', label: 'First to 7', rules: { kind: 'first', goals: 7 } },
  { id: 't3', label: '3 min', rules: { kind: 'timed', seconds: 180 } },
  { id: 't5', label: '5 min', rules: { kind: 'timed', seconds: 300 } },
];

export const DEFAULT_RULES = RULE_OPTIONS[0]!.rules;

export const ruleId = (rules: Rules) =>
  RULE_OPTIONS.find(o => JSON.stringify(o.rules) === JSON.stringify(rules))?.id ?? null;

/** Rules from somewhere less trusted (storage, another browser): one on offer, or the default. */
export function cleanRules(raw: unknown): Rules {
  const found = RULE_OPTIONS.find(o => JSON.stringify(o.rules) === JSON.stringify(raw));
  return found ? { ...found.rules } : { ...DEFAULT_RULES };
}

export const clockText = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** How the match is won, for the board under the billboard. */
export function rulesName(rules: Rules): string {
  if (rules.kind === 'first') return `First to ${rules.goals}`;
  if (rules.kind === 'timed') return `${Math.round(rules.seconds / 60)} min match`;
  return '';
}

/** How it stands: goals still to win (or match point), the time left, or a golden goal. */
export function rulesLine(rules: Rules, clock: number, score: { gold: number; red: number }): string {
  if (rules.kind === 'first') {
    const left = rules.goals - Math.max(score.gold, score.red);
    return left <= 1 ? 'Match point' : `${left} to win`;
  }
  if (rules.kind === 'timed') return clock >= rules.seconds ? 'Golden goal' : clockText(rules.seconds - clock);
  return '';
}

export const loadKeepers = () => store.get(localStorage, KEYS.keepers) === 'on';
export const saveKeepers = (on: boolean) => store.set(localStorage, KEYS.keepers, on ? 'on' : 'off');
export const loadRules = (): Rules => cleanRules(store.getJSON(localStorage, KEYS.rules));
export const saveRules = (rules: Rules) => store.setJSON(localStorage, KEYS.rules, rules);
