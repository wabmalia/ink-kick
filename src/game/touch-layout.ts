// Where the touch buttons sit and how big they are, set by the player in the
// controls editor (ui/controls-editor.ts) and kept on the device. Kick and
// Sprint are placed by their centre, measured in CSS px from the screen's
// bottom-right corner (inside the safe area), so a layout carries over to
// any phone; the stick only has a size, since it centres on the thumb.
// Buttons stay in the right half, clear of the top buttons, on screen, and
// never overlapping, so one press can't hit both. A left-handed layout
// would mirror the half (not yet).

export interface ButtonSpot { x: number; y: number; d: number }
export interface TouchLayout { kick: ButtonSpot; sprint: ButtonSpot; stick: { d: number } }
export type Movable = 'kick' | 'sprint';

export const DEFAULT_LAYOUT: TouchLayout = {
  kick: { x: 57, y: 57, d: 66 },
  sprint: { x: 126, y: 38, d: 48 },
  stick: { d: 96 },
};
/** Diameters allowed, in CSS px. */
export const BUTTON_D: [number, number] = [40, 112];
export const STICK_D: [number, number] = [70, 160];
/** Kept free above the buttons: the corner buttons at the top. */
export const TOP_CLEAR = 60;
/** Room between the two buttons, and to the screen's edges. */
export const GAP = 8;
const EDGE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const other = (k: Movable): Movable => (k === 'kick' ? 'sprint' : 'kick');
const overlaps = (a: ButtonSpot, b: ButtonSpot) => Math.hypot(a.x - b.x, a.y - b.y) < (a.d + b.d) / 2 + GAP;

/** A button's centre kept on screen, in the right half, under the top clearance. */
function bounded(s: ButtonSpot, w: number, h: number): ButtonSpot {
  const r = s.d / 2;
  return {
    d: s.d,
    x: Math.round(clamp(s.x, r + EDGE, Math.max(r + EDGE, w / 2 - r))),
    y: Math.round(clamp(s.y, r + EDGE, Math.max(r + EDGE, h - TOP_CLEAR - r))),
  };
}

/** Moves a button's centre to (x, y), measured from the bottom-right; it
 *  stops short of the other button rather than overlap it. */
export function moveButton(layout: TouchLayout, key: Movable, x: number, y: number, w: number, h: number): TouchLayout {
  const fixed = layout[other(key)];
  let next = bounded({ ...layout[key], x, y }, w, h);
  if (overlaps(next, fixed)) {
    // Slide out along the line from the other button until it clears.
    const dx = next.x - fixed.x;
    const dy = next.y - fixed.y;
    const len = Math.hypot(dx, dy) || 1;
    const need = (next.d + fixed.d) / 2 + GAP + 0.5;
    next = bounded({ ...next, x: fixed.x + (dx / len) * need, y: fixed.y + (dy / len) * need }, w, h);
    // Pinned against an edge and still overlapping: stay where it was.
    if (overlaps(next, fixed)) return layout;
  }
  return { ...layout, [key]: next };
}

/** Resizes a button to diameter d, as large as fits next to the other one. */
export function resizeButton(layout: TouchLayout, key: Movable, d: number, w: number, h: number): TouchLayout {
  const fixed = layout[other(key)];
  const cur = layout[key];
  let size = Math.round(clamp(d, BUTTON_D[0], BUTTON_D[1]));
  // Growing into the other button: only as far as the gap allows.
  const room = 2 * (Math.hypot(cur.x - fixed.x, cur.y - fixed.y) - GAP) - fixed.d;
  if (size > cur.d) size = Math.max(cur.d, Math.min(size, Math.floor(room)));
  const next = bounded({ ...cur, d: size }, w, h);
  return overlaps(next, fixed) ? layout : { ...layout, [key]: next };
}

export function resizeStick(layout: TouchLayout, d: number): TouchLayout {
  return { ...layout, stick: { d: Math.round(clamp(d, STICK_D[0], STICK_D[1])) } };
}

/** A saved layout, checked, and fitted to this screen; anything off falls back to the default. */
export function fitLayout(raw: unknown, w: number, h: number): TouchLayout {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const spot = (k: Movable): ButtonSpot => ({
    x: num(r[k]?.x, DEFAULT_LAYOUT[k].x),
    y: num(r[k]?.y, DEFAULT_LAYOUT[k].y),
    d: clamp(num(r[k]?.d, DEFAULT_LAYOUT[k].d), BUTTON_D[0], BUTTON_D[1]),
  });
  const layout: TouchLayout = {
    kick: bounded(spot('kick'), w, h),
    sprint: bounded(spot('sprint'), w, h),
    stick: { d: clamp(num(r.stick?.d, DEFAULT_LAYOUT.stick.d), STICK_D[0], STICK_D[1]) },
  };
  return overlaps(layout.kick, layout.sprint) ? { ...DEFAULT_LAYOUT } : layout;
}
