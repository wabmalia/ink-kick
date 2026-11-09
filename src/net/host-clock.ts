import { CONFIG } from '../config';

// Hosting must not depend on animation frames. Background browsers may
// still throttle timers; this is not an always-on server guarantee.
export class HostClock {
  private timer: ReturnType<typeof setInterval> | undefined;
  private last = 0;

  constructor(private advance: (dt: number) => void) {}

  start() {
    if (this.timer !== undefined) return;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
      this.last = now;
      this.advance(dt);
    }, CONFIG.tick * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
