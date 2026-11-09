import { afterEach, expect, it, vi } from 'vitest';
import { HostClock, intervalTicker } from './host-clock';
import { LocalMatch } from '../game/state';
import { HostRoom } from './room';

let clock: HostClock;
afterEach(() => { clock?.stop(); vi.useRealTimers(); });

it('advances the host and delivers snapshots without any animation frames', () => {
  vi.useFakeTimers();
  const room = new HostRoom('ABCDE', 'host', 'Host', { change: () => {} });
  const snapshots: unknown[] = [];
  room.join('guest', 'Guest', { send: () => {}, sendState: m => snapshots.push(m) });
  room.start();
  const local = new LocalMatch(room.match!, () => room.step({ x: 0, y: 0, kick: false, sprint: false }));
  clock = new HostClock(dt => local.advance(dt));
  clock.start();
  clock.start();
  vi.advanceTimersByTime(1000);
  expect(room.tick).toBeGreaterThanOrEqual(58);
  expect(room.tick).toBeLessThanOrEqual(60);
  expect(snapshots.length).toBeGreaterThanOrEqual(29);
  const tick = room.tick;
  clock.stop();
  vi.advanceTimersByTime(2000);
  expect(room.tick).toBe(tick);
});

it('bounds catch-up work after a stalled scheduler', () => {
  vi.useFakeTimers();
  const advance = vi.fn();
  clock = new HostClock(advance);
  clock.start();
  const now = vi.spyOn(performance, 'now').mockReturnValue(60_000);
  vi.advanceTimersByTime(20);
  expect(advance).toHaveBeenCalledWith(0.1);
  now.mockRestore();
});

it('steps from animation frames while they run, and from the timer once they stop', () => {
  vi.useFakeTimers();
  const advance = vi.fn();
  let now = 0;
  const time = vi.spyOn(performance, 'now').mockImplementation(() => now);
  clock = new HostClock(advance, intervalTicker);
  clock.start();
  // Frames every 8 ms (a 120 Hz screen): the timer stays out of it.
  for (let i = 0; i < 20; i++) {
    now += 8;
    clock.frame();
    vi.advanceTimersByTime(8);
  }
  expect(advance).toHaveBeenCalledTimes(20);
  const stepped = advance.mock.calls.reduce((sum, [dt]) => sum + dt, 0);
  expect(stepped).toBeCloseTo(0.16);
  // Frames stop (a hidden tab): the timer carries on after a short gap.
  advance.mockClear();
  for (let i = 0; i < 60; i++) {
    now += 1000 / 60;
    vi.advanceTimersByTime(1000 / 60);
  }
  expect(advance.mock.calls.length).toBeGreaterThan(50);
  time.mockRestore();
});

it('ignores frames while stopped', () => {
  const advance = vi.fn();
  clock = new HostClock(advance, intervalTicker);
  clock.frame();
  expect(advance).not.toHaveBeenCalled();
});

it('falls back to a page timer without workers', () => {
  vi.useFakeTimers();
  const advance = vi.fn();
  clock = new HostClock(advance);
  clock.start();
  vi.advanceTimersByTime(1000);
  expect(advance).toHaveBeenCalled();
});
