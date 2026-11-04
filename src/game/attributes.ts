// A player's attributes: six whole numbers from 1 to 10 that add up to 30,
// less any points taken off one and not yet spent on another. Set in the Locker room; see docs/attributes.md for what each will do.
// The sim doesn't use them yet.

export const ATTRIBUTES = ['pace', 'stamina', 'dribbling', 'power', 'tackling', 'strength'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Attributes = Record<Attribute, number>;

export const LABELS: Record<Attribute, string> = {
  pace: 'Pace',
  stamina: 'Stamina',
  dribbling: 'Dribbling',
  power: 'Power',
  tackling: 'Tackling',
  strength: 'Strength',
};

export const MIN = 1;
export const MAX = 10;
export const DEFAULT = 5;
export const TOTAL = DEFAULT * ATTRIBUTES.length;

export const evenAttributes = (): Attributes =>
  Object.fromEntries(ATTRIBUTES.map(a => [a, DEFAULT])) as Attributes;

const sum = (attrs: Attributes) => ATTRIBUTES.reduce((s, a) => s + attrs[a], 0);

// Points taken off an attribute and not yet put on another. A lowered
// attribute frees a point here, and a raise spends one, so the attributes and
// the spare points always add up to 30.
export const spare = (attrs: Attributes) => TOTAL - sum(attrs);

export const canRaise = (attrs: Attributes, key: Attribute) => attrs[key] < MAX && spare(attrs) > 0;
export const canLower = (attrs: Attributes, key: Attribute) => attrs[key] > MIN;

// One point onto or off an attribute, or the same attributes if that isn't
// allowed.
export const raise = (attrs: Attributes, key: Attribute): Attributes =>
  canRaise(attrs, key) ? { ...attrs, [key]: attrs[key] + 1 } : attrs;
export const lower = (attrs: Attributes, key: Attribute): Attributes =>
  canLower(attrs, key) ? { ...attrs, [key]: attrs[key] - 1 } : attrs;

// Attributes as stored or sent by someone else: whole, in range and adding up
// to 30 at most (the rest unspent), or the even default.
export function cleanAttributes(raw: unknown): Attributes {
  const r = raw as Partial<Record<Attribute, unknown>> | null;
  if (!r || typeof r !== 'object') return evenAttributes();
  const values = ATTRIBUTES.map(a => r[a]);
  const ok = values.every(v => Number.isInteger(v) && (v as number) >= MIN && (v as number) <= MAX);
  if (!ok || values.reduce<number>((s, v) => s + (v as number), 0) > TOTAL) return evenAttributes();
  return Object.fromEntries(ATTRIBUTES.map((a, i) => [a, values[i]])) as Attributes;
}

const KEY = 'score.attributes';

export function loadAttributes(): Attributes {
  try {
    return cleanAttributes(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return evenAttributes();
  }
}

export function saveAttributes(attrs: Attributes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(attrs));
  } catch {
    /* private mode or blocked storage: it just won't be remembered */
  }
}
