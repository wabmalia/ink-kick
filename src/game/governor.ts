import type { Quality } from './view';

// Dynamic resolution for phones and tablets: drawing quality that follows
// what the device keeps up with, measured from frame times while playing.
//
// A ladder of levels, sharpest first, all without multisampling (it bought
// little on a 3x screen and cost frames). Late frames step down quickly;
// steady frames step back up only after a long while, and a level that ran
// late once in a session isn't tried again, so it can't flicker between
// two. The level is kept on the device, so the next visit starts there
// (and can still climb back, the failures being per session). The game is
// capped at 60 fps, so on-time frames say nothing about spare capacity: the
// only way to find out is to try the next level up.
// Measured on an iPhone 15 (docs/render-performance.md): density 2 drew 42
// fps, 1.5 about 55, 1 a steady 60.

export const LEVELS: Quality[] = [
  { ratio: 1.5, shadows: true, samples: 0 },
  { ratio: 1.25, shadows: true, samples: 0 },
  { ratio: 1, shadows: true, samples: 0 },
  { ratio: 1, shadows: false, samples: 0 },
];

/** A 60 Hz frame is 16.7 ms: averaging more than this over a window is late. */
export const LATE_MS = 18;
/** Frames are judged over windows this long. */
export const WINDOW_MS = 2000;
/** After starting, resuming or changing level: frames not judged yet. */
export const SETTLE_MS = 1500;
/** Steady play needed before trying a level up. */
export const UPGRADE_AFTER_MS = 20000;
/** One stall (a pause, a tab coming back) counts as no more than this. */
const CAP_MS = 50;

export class Governor {
  level: number;
  private failed = new Set<number>();
  private settle = SETTLE_MS;
  private window: number[] = [];
  private windowMs = 0;
  private steady = 0;

  constructor(start = 0) {
    // A saved level, whatever it holds: a whole step on the ladder.
    this.level = Math.min(Math.max(0, Math.round(start) || 0), LEVELS.length - 1);
  }

  get quality(): Quality {
    return LEVELS[this.level]!;
  }

  /** Not measuring (a menu, a dialog, the window unfocused): start fresh after. */
  pause() {
    this.settle = SETTLE_MS;
    this.window = [];
    this.windowMs = 0;
  }

  /** One drawn frame's interval in ms. Returns the new level when it changes. */
  frame(ms: number): number | null {
    if (this.settle > 0) {
      this.settle -= ms;
      return null;
    }
    const capped = Math.min(ms, CAP_MS);
    this.window.push(capped);
    this.windowMs += capped;
    if (this.windowMs < WINDOW_MS) return null;

    const avg = this.windowMs / this.window.length;
    this.window = [];
    this.windowMs = 0;
    if (avg > LATE_MS) {
      // Too much for this device, for the rest of the session.
      this.failed.add(this.level);
      this.steady = 0;
      return this.level < LEVELS.length - 1 ? this.set(this.level + 1) : null;
    }
    this.steady += WINDOW_MS;
    if (this.steady >= UPGRADE_AFTER_MS && this.level > 0 && !this.failed.has(this.level - 1)) {
      this.steady = 0;
      return this.set(this.level - 1);
    }
    return null;
  }

  private set(level: number) {
    this.level = level;
    this.settle = SETTLE_MS;
    return level;
  }
}
