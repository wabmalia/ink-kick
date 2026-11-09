import { CONFIG } from '../config';

// Steps the host's match. While the tab is drawing, animation frames do it
// (see frame()), so the drawn tick-to-tick blend uses up-to-date time. When
// frames stop (a hidden or covered tab), a timer takes over so guests keep
// playing.
//
// The timer runs in a worker: browsers slow a background tab's own timers
// to about once a second, which with the 0.1 s step cap would play the
// match at a tenth of its speed. Worker timers aren't slowed that way in
// Chrome or Firefox. Browsers can still freeze a tab outright, so this is
// not an always-on server.

/** No frame for this long and the timer starts stepping. */
const FRAME_GAP_MS = 100;
/** Most simulated time one step catches up, as in LocalMatch.advance. */
const MAX_STEP = 0.1;

/** Calls `fn` every `ms`; returns a function that stops it. */
export type Ticker = (fn: () => void, ms: number) => () => void;

export const intervalTicker: Ticker = (fn, ms) => {
  const timer = setInterval(fn, ms);
  return () => clearInterval(timer);
};

/** A worker's timer, falling back to the page's own if workers aren't available. */
export const workerTicker: Ticker = (fn, ms) => {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return intervalTicker(fn, ms);
  }
  let url: string | null = null;
  let worker: Worker | null = null;
  let fallback: (() => void) | null = null;
  const stopWorker = () => {
    worker?.terminate();
    worker = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  try {
    url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onmessage = fn;
    // Blocked by a content policy, say: use the page's timer instead.
    worker.onerror = () => {
      stopWorker();
      fallback ??= intervalTicker(fn, ms);
    };
  } catch {
    stopWorker();
    fallback = intervalTicker(fn, ms);
  }
  return () => {
    stopWorker();
    fallback?.();
  };
};

export class HostClock {
  private stopTicker: (() => void) | null = null;
  private last = 0;
  private lastFrame = -Infinity;

  constructor(private advance: (dt: number) => void, private ticker: Ticker = workerTicker) {}

  start() {
    if (this.stopTicker) return;
    this.last = performance.now();
    this.lastFrame = -Infinity;
    this.stopTicker = this.ticker(() => {
      const now = performance.now();
      if (now - this.lastFrame > FRAME_GAP_MS) this.step(now);
    }, CONFIG.tick * 1000);
  }

  /** An animation frame: step now, and keep the timer out of it. */
  frame() {
    if (!this.stopTicker) return;
    const now = performance.now();
    this.lastFrame = now;
    this.step(now);
  }

  stop() {
    this.stopTicker?.();
    this.stopTicker = null;
  }

  private step(now: number) {
    const dt = Math.max(0, Math.min(MAX_STEP, (now - this.last) / 1000));
    this.last = now;
    this.advance(dt);
  }
}
