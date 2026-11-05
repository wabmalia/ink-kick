import type { Rules } from '../engine/sim';

// The match lengths on offer before a kickoff, and how each reads on the
// scoreboard. "Best of" counts goals, like games in a series: best of 5 is
// first to 3.

export interface RuleOption {
  id: string;
  label: string;
  rules: Rules;
}

export const RULE_OPTIONS: RuleOption[] = [
  { id: 'bo3', label: 'Best of 3', rules: { kind: 'first', goals: 2 } },
  { id: 'bo5', label: 'Best of 5', rules: { kind: 'first', goals: 3 } },
  { id: 'bo7', label: 'Best of 7', rules: { kind: 'first', goals: 4 } },
  { id: 't3', label: '3 min', rules: { kind: 'timed', seconds: 180 } },
  { id: 't5', label: '5 min', rules: { kind: 'timed', seconds: 300 } },
];

export const DEFAULT_RULES = RULE_OPTIONS[1]!.rules;

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
  if (rules.kind === 'first') return RULE_OPTIONS.find(o => ruleId(o.rules) === ruleId(rules))?.label ?? `First to ${rules.goals}`;
  if (rules.kind === 'timed') return `${Math.round(rules.seconds / 60)} min match`;
  return '';
}

/** How it stands: the target, the time left, or a golden goal. */
export function rulesLine(rules: Rules, clock: number): string {
  if (rules.kind === 'first') return `First to ${rules.goals}`;
  if (rules.kind === 'timed') return clock >= rules.seconds ? 'Golden goal' : clockText(rules.seconds - clock);
  return '';
}

const KEY = 'score.rules';

export function loadRules(): Rules {
  try {
    return cleanRules(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_RULES };
  }
}

export function saveRules(rules: Rules) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
  } catch {
    /* not remembered, that's all */
  }
}
