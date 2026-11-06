// Small maths shared across the game.

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ease in and out over 0..1 (smoothstep), held at the ends outside it. */
export const smooth = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** The turn from one angle to another, radians, the shorter way round (-π..π). */
export function angleBetween(from: number, to: number) {
  return ((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/** One step of mulberry32: from a state, the next state and a number in 0..1. */
export function mulberry32(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** Repeatable random numbers in 0..1 from a seed. */
export function seeded(seed: number) {
  return () => {
    const [s, v] = mulberry32(seed);
    seed = s;
    return v;
  };
}
